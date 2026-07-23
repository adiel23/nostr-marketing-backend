import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import {
  calculatePlatformFeeMsats,
  calculateRequiredImpactBalanceMsats,
  satsToMsats,
} from 'src/common/fees.util';
import { CampaignJobData } from './nostr.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import {
  CommentStatus,
  ImpactStatus,
  PaymentProgressStatus,
} from 'src/impacts/entities/impact.entity';
import { ImpactsService } from 'src/impacts/impacts.service';
import {
  CampaignCommentMode,
  CampaignStatus,
} from 'src/campaigns/entities/campaign.entity';
import { LlmService } from 'src/llm/llm.service';
import { ImpactPaymentType } from 'src/impacts/entities/impact-payment.entity';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface ImpactExecutionResult {
  status: ImpactStatus | 'skipped_campaign_inactive';
  impactId: string;
  commentEventId: string | null;
  zapSent: boolean;
}

@Injectable()
export class ImpactExecutionService {
  private readonly logger = new Logger(ImpactExecutionService.name);

  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly impactsService: ImpactsService,
    private readonly nostrPublisher: NostrPublisher,
    private readonly walletService: WalletService,
    private readonly llmService: LlmService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async recoverPendingImpacts(): Promise<void> {
    const pending = await this.impactsService.findRecoverable();
    for (const impact of pending) {
      const campaign = await this.campaignsService.findById(impact.campaignId);
      if (!campaign) continue;
      try {
        await this.executeApprovedImpact({
          campaignId: campaign.id,
          campaignName: campaign.name,
          productDescription: campaign.productDescription,
          foundKeywords: impact.foundKeywords,
          eventId: impact.targetEventId,
          pubkey: impact.targetPubkey,
          content: impact.targetContent ?? '',
          createdAt: Math.floor(impact.createdAt.getTime() / 1000),
        });
      } catch (error) {
        this.logger.warn(
          `Fee pendiente para la campaña "${campaign.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async executeApprovedImpact(
    jobData: CampaignJobData,
  ): Promise<ImpactExecutionResult> {
    const campaign = await this.campaignsService.findById(jobData.campaignId);
    if (!campaign) {
      throw new NotFoundException(
        `Campaña ${jobData.campaignId} no encontrada`,
      );
    }

    // Los impactos pendientes de facturación deben poder recuperarse aunque la
    // campaña esté bloqueada. Las campañas pausadas o finalizadas no ejecutan
    // ningún efecto externo.
    if (
      ![CampaignStatus.ACTIVE, CampaignStatus.BILLING_BLOCKED].includes(
        campaign.status,
      )
    ) {
      return {
        status: 'skipped_campaign_inactive',
        impactId: '',
        commentEventId: null,
        zapSent: false,
      };
    }

    const impact = await this.impactsService.findOrCreateProcessing({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      targetContent: jobData.content,
      foundKeywords: jobData.foundKeywords,
    });

    if (this.isTerminal(impact.status)) {
      return this.toResult(impact);
    }

    const zapAmountMsats = satsToMsats(campaign.satsPerImpact);

    // El saldo se comprueba antes de generar, firmar o guardar el comentario.
    // El fee depende del modo de la campaña, no del texto generado.
    if (impact.commentStatus !== CommentStatus.PUBLISHED) {
      const platformFeeMsats = calculatePlatformFeeMsats(
        campaign.satsPerImpact,
        campaign.commentMode,
      );
      const requiredMsats = calculateRequiredImpactBalanceMsats(
        zapAmountMsats,
        platformFeeMsats,
      );
      const balanceMsats = await this.walletService.getAdvertiserBalanceMsats(
        campaign.nwcUrlEncrypted,
      );

      if (balanceMsats < requiredMsats) {
        await this.impactsService.markFundsInsufficient(impact.id);
        await this.campaignsService.pauseForInsufficientFunds(campaign.id);
        return {
          status: ImpactStatus.FUNDS_INSUFFICIENT,
          impactId: impact.id,
          commentEventId: null,
          zapSent: false,
        };
      }
    }

    let platformPayment = await this.impactsService.getPayment(
      impact.id,
      ImpactPaymentType.PLATFORM_FEE,
    );

    if (!platformPayment || !impact.signedComment) {
      const comment = await this.resolvePromotionalComment(campaign, jobData);

      if (!platformPayment) {
        const platformFeeMsats = calculatePlatformFeeMsats(
          campaign.satsPerImpact,
          comment.modeUsed,
        );

        platformPayment = await this.impactsService.ensurePayment(
          impact.id,
          ImpactPaymentType.PLATFORM_FEE,
          platformFeeMsats.toString(),
        );
      }

      if (!impact.signedComment) {
        const signedComment = this.nostrPublisher.prepareComment({
          targetEventId: jobData.eventId,
          targetPubkey: jobData.pubkey,
          content: comment.content,
        });

        await this.impactsService.savePreparedComment(
          impact.id,
          comment.content,
          signedComment,
        );

        impact.signedComment = signedComment;
        impact.commentContent = comment.content;
        impact.commentEventId = signedComment.id;
        impact.commentStatus = CommentStatus.PREPARED;
      }
    }

    if (!platformPayment.invoice || !platformPayment.paymentHash) {
      let invoice: { invoice: string; paymentHash: string };
      try {
        invoice = await this.walletService.createPlatformFeeInvoice(
          platformPayment.amountMsats,
          impact.id,
        );
      } catch (error) {
        await this.campaignsService.markBillingBlocked(campaign.id);
        throw error;
      }
      await this.impactsService.savePaymentInvoice(
        platformPayment.id,
        invoice.invoice,
        invoice.paymentHash,
      );
      platformPayment.invoice = invoice.invoice;
      platformPayment.paymentHash = invoice.paymentHash;
      await this.campaignsService.restoreAfterBilling(campaign.id);
    }

    if (impact.commentStatus !== CommentStatus.PUBLISHED) {
      if (!impact.signedComment) {
        throw new Error('El comentario no fue preparado antes de publicarse.');
      }
      try {
        await this.nostrPublisher.publishPreparedComment(impact.signedComment);
        await this.impactsService.markCommentPublished(impact.id);
        impact.commentStatus = CommentStatus.PUBLISHED;
      } catch (error) {
        await this.impactsService.markFailedBeforeComment(impact.id);
        throw error;
      }
    }

    if (platformPayment.status !== PaymentProgressStatus.PAID) {
      const invoiceState = await this.walletService.getPlatformInvoiceState(
        platformPayment.paymentHash,
      );
      if (invoiceState === 'expired') {
        const replacement = await this.walletService.createPlatformFeeInvoice(
          platformPayment.amountMsats,
          impact.id,
        );
        await this.impactsService.savePaymentInvoice(
          platformPayment.id,
          replacement.invoice,
          replacement.paymentHash,
        );
        platformPayment.invoice = replacement.invoice;
        platformPayment.paymentHash = replacement.paymentHash;
      }
      const feeResult = await this.walletService.payAdvertiserInvoice(
        campaign.nwcUrlEncrypted,
        platformPayment.invoice,
      );
      if (!feeResult.success) {
        const wasPaid = await this.walletService.isPlatformInvoicePaid(
          platformPayment.paymentHash,
        );
        if (!wasPaid) {
          await this.impactsService.recordPaymentFailure(
            platformPayment.id,
            feeResult.reason,
            feeResult.message,
            true,
          );
          await this.impactsService.markFeePending(impact.id);
          await this.campaignsService.markBillingBlocked(campaign.id);
          throw new Error(`Fee de plataforma pendiente: ${feeResult.message}`);
        }
        await this.impactsService.markPaymentPaid(platformPayment.id, '0');
      } else {
        await this.impactsService.markPaymentPaid(
          platformPayment.id,
          feeResult.feesPaidMsats,
          feeResult.preimage,
        );
      }
      platformPayment.status = PaymentProgressStatus.PAID;
      await this.campaignsService.restoreAfterBilling(campaign.id);
    }

    const zapPayment = await this.impactsService.ensurePayment(
      impact.id,
      ImpactPaymentType.ZAP,
      zapAmountMsats.toString(),
    );
    if (zapPayment.status === PaymentProgressStatus.PAID) {
      await this.impactsService.markCompleted(impact.id, true);
      return {
        status: ImpactStatus.FULL_SUCCESS,
        impactId: impact.id,
        commentEventId: impact.commentEventId,
        zapSent: true,
      };
    }

    if (!zapPayment.invoice) {
      const preparedZap = await this.walletService.prepareZap({
        targetPubkey: jobData.pubkey,
        targetEventId: jobData.eventId,
        amountMsats: zapAmountMsats.toString(),
      });
      if (!preparedZap.success) {
        await this.impactsService.markPaymentSkipped(
          zapPayment.id,
          preparedZap.reason,
          preparedZap.message,
        );
        await this.impactsService.markCompleted(impact.id, false);
        return {
          status: ImpactStatus.COMMENT_ONLY,
          impactId: impact.id,
          commentEventId: impact.commentEventId,
          zapSent: false,
        };
      }
      await this.impactsService.savePaymentInvoice(
        zapPayment.id,
        preparedZap.invoice,
        null,
      );
      zapPayment.invoice = preparedZap.invoice;
    }

    const zapResult = await this.walletService.payAdvertiserInvoice(
      campaign.nwcUrlEncrypted,
      zapPayment.invoice,
    );
    if (!zapResult.success) {
      await this.impactsService.recordPaymentFailure(
        zapPayment.id,
        zapResult.reason,
        zapResult.message,
        false,
      );
      await this.impactsService.markCompleted(impact.id, false);
      return {
        status: ImpactStatus.COMMENT_ONLY,
        impactId: impact.id,
        commentEventId: impact.commentEventId,
        zapSent: false,
      };
    }

    await this.impactsService.markPaymentPaid(
      zapPayment.id,
      zapResult.feesPaidMsats,
      zapResult.preimage,
    );
    await this.impactsService.markCompleted(impact.id, true);
    return {
      status: ImpactStatus.FULL_SUCCESS,
      impactId: impact.id,
      commentEventId: impact.commentEventId,
      zapSent: true,
    };
  }

  private isTerminal(status: ImpactStatus): boolean {
    return [
      ImpactStatus.FULL_SUCCESS,
      ImpactStatus.COMMENT_ONLY,
      ImpactStatus.FUNDS_INSUFFICIENT,
    ].includes(status);
  }

  private toResult(impact: {
    id: string;
    status: ImpactStatus;
    commentEventId: string | null;
    zapStatus: PaymentProgressStatus;
  }): ImpactExecutionResult {
    return {
      status: impact.status,
      impactId: impact.id,
      commentEventId: impact.commentEventId,
      zapSent: impact.zapStatus === PaymentProgressStatus.PAID,
    };
  }

  private async resolvePromotionalComment(
    campaign: {
      name: string;
      productDescription: string;
      promotionalComment: string;
      commentMode: CampaignCommentMode;
    },
    jobData: CampaignJobData,
  ): Promise<{ content: string; modeUsed: CampaignCommentMode }> {
    if (campaign.commentMode !== CampaignCommentMode.AI) {
      return {
        content: campaign.promotionalComment,
        modeUsed: CampaignCommentMode.FIXED,
      };
    }

    const generated = await this.llmService.generatePromotionalComment({
      postContent: jobData.content,
      campaignName: campaign.name,
      productDescription: campaign.productDescription,
      promotionalComment: campaign.promotionalComment,
      foundKeywords: jobData.foundKeywords,
    });

    if (!generated?.content) {
      return {
        content: campaign.promotionalComment,
        modeUsed: CampaignCommentMode.FIXED,
      };
    }
    return { content: generated.content, modeUsed: CampaignCommentMode.AI };
  }
}
