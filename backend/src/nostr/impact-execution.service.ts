import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { calculatePlatformFee } from 'src/common/fees.util';
import { CampaignJobData } from './nostr.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import { ImpactStatus } from 'src/impacts/entities/impact.entity';
import { ImpactsService } from 'src/impacts/impacts.service';
import { CampaignCommentMode } from 'src/campaigns/entities/campaign.entity';
import { LlmService } from 'src/llm/llm.service';

export interface ImpactExecutionResult {
  status: ImpactStatus;
  impactId: string;
  commentEventId: string;
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

  async executeApprovedImpact(
    jobData: CampaignJobData,
  ): Promise<ImpactExecutionResult> {
    const existingImpact = await this.impactsService.findByTargetEventId(
      jobData.eventId,
    );
    if (existingImpact) {
      this.logger.warn(`Impacto ya registrado para evento ${jobData.eventId}`);
      return {
        status: existingImpact.status,
        impactId: existingImpact.id,
        commentEventId: existingImpact.commentEventId ?? jobData.eventId,
        zapSent: existingImpact.status === ImpactStatus.FULL_SUCCESS,
      };
    }

    const campaign = await this.campaignsService.findById(jobData.campaignId);
    if (!campaign) {
      throw new NotFoundException(
        `Campaña ${jobData.campaignId} no encontrada`,
      );
    }

    const commentResolution = await this.resolvePromotionalComment(
      campaign,
      jobData,
    );
    
    const platformFee = calculatePlatformFee(
      campaign.satsPerImpact,
      commentResolution.modeUsed,
    );

    const { eventId: commentEventId } =
      await this.nostrPublisher.publishComment({
        targetEventId: jobData.eventId,
        targetPubkey: jobData.pubkey,
        content: commentResolution.content,
      });

    const zapResult = await this.walletService.sendZap({
      encryptedNwcUrl: campaign.nwcUrlEncrypted,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      amountSats: campaign.satsPerImpact,
    });

    const status = zapResult.success
      ? ImpactStatus.FULL_SUCCESS
      : ImpactStatus.COMMENT_ONLY;

    const zapSats = zapResult.success ? campaign.satsPerImpact : 0;
    const lightningFeeSats = zapResult.success ? zapResult.feesPaid : 0;
    const totalSpentSats = zapSats + lightningFeeSats + platformFee;

    const impact = await this.impactsService.createImpact({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      targetContent: jobData.content,
      commentContent: commentResolution.content,
      commentEventId,
      foundKeywords: jobData.foundKeywords,
      status,
      satsCharged: totalSpentSats,
      zapSats,
      lightningFeeSats,
      platformFee,
      totalSpentSats,
    });

    if (!zapResult.success) {
      this.logger.warn(
        `Impacto ${impact.id} registrado como comment_only: ${zapResult.message}`,
      );
    }

    return {
      status,
      impactId: impact.id,
      commentEventId,
      zapSent: zapResult.success,
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

    return {
      content: generated.content,
      modeUsed: CampaignCommentMode.AI,
    };
  }
}
