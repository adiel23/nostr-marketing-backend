import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { CampaignStatus } from 'src/campaigns/entities/campaign.entity';
import {
  calculatePlatformFee,
  estimateImpactCostSats,
} from 'src/common/fees.util';
import { CampaignJobData } from './nostr.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import { Impact, ImpactStatus } from 'src/impacts/entities/impact.entity';
import { ImpactsService } from 'src/impacts/impacts.service';

export interface ImpactExecutionResult {
  status: ImpactStatus;
  impactId: string;
  commentEventId: string;
  zapSent: boolean;
}

// Un pending mas viejo que esto se considera huerfano (proceso caido,
// timeout de wallet, etc.) y el reconciliador lo cierra sin volver a pagar.
const PENDING_RECONCILIATION_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class ImpactExecutionService {
  private readonly logger = new Logger(ImpactExecutionService.name);

  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly impactsService: ImpactsService,
    private readonly nostrPublisher: NostrPublisher,
    private readonly walletService: WalletService,
  ) {}

  async executeApprovedImpact(
    jobData: CampaignJobData,
  ): Promise<ImpactExecutionResult> {
    const campaign = await this.campaignsService.findById(jobData.campaignId);
    if (!campaign) {
      throw new NotFoundException(
        `Campaña ${jobData.campaignId} no encontrada`,
      );
    }

    if (
      campaign.status !== CampaignStatus.ACTIVE ||
      campaign.endsAt.getTime() <= Date.now()
    ) {
      throw new ConflictException('La campana no esta activa o ya finalizo.');
    }

    const reservation = await this.impactsService.reserveImpact({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      reserveSats: estimateImpactCostSats(campaign.satsPerImpact),
    });

    if (!reservation.reserved) {
      return {
        status: reservation.impact.status,
        impactId: reservation.impact.id,
        commentEventId: reservation.impact.commentEventId ?? jobData.eventId,
        zapSent: reservation.impact.status === ImpactStatus.FULL_SUCCESS,
      };
    }

    const platformFee = calculatePlatformFee(campaign.satsPerImpact);
    const promotionalContent = this.buildPromotionalComment(
      campaign.name,
      campaign.productDescription,
    );

    const { eventId: commentEventId } =
      await this.nostrPublisher.publishComment({
        targetEventId: jobData.eventId,
        targetPubkey: jobData.pubkey,
        content: promotionalContent,
      });

    const zapResult = await this.walletService.sendZap({
      encryptedNwcUrl: campaign.nwcUrlEncrypted,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      amountSats: campaign.satsPerImpact,
      onInvoiceReady: (info) =>
        this.impactsService.recordPaymentAttempt(reservation.impact.id, info),
    });

    const status = zapResult.success
      ? ImpactStatus.FULL_SUCCESS
      : ImpactStatus.COMMENT_ONLY;

    const satsCharged = zapResult.success
      ? campaign.satsPerImpact + platformFee + zapResult.feesPaid
      : platformFee;

    const impact = await this.impactsService.completeImpact(
      reservation.impact.id,
      {
        status,
        satsCharged,
        platformFee,
        commentEventId,
        preimage: zapResult.success ? zapResult.preimage : undefined,
      },
    );

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

  /**
   * Cierra impactos pending huerfanos verificando con la wallet si el
   * pago realmente se liquido, en vez de dejarlos bloqueando para
   * siempre el slot unico (campana, pubkey/evento).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcileStalePendingImpacts(): Promise<void> {
    const staleBefore = new Date(
      Date.now() - PENDING_RECONCILIATION_TIMEOUT_MS,
    );
    const staleImpacts =
      await this.impactsService.findStalePending(staleBefore);

    for (const impact of staleImpacts) {
      await this.reconcileImpact(impact);
    }
  }

  private async reconcileImpact(impact: Impact): Promise<void> {
    const campaign = await this.campaignsService.findById(impact.campaignId);

    if (!campaign || !impact.paymentHash) {
      // Sin campaña o sin intento de pago registrado: no se gasto nada
      // mas alla del comentario ya publicado (si lo hubo).
      const platformFee = campaign
        ? calculatePlatformFee(campaign.satsPerImpact)
        : 0;
      await this.impactsService.completeImpact(impact.id, {
        status: ImpactStatus.COMMENT_ONLY,
        satsCharged: platformFee,
        platformFee,
      });
      return;
    }

    const paymentStatus = await this.walletService.checkPaymentStatus(
      campaign.nwcUrlEncrypted,
      impact.paymentHash,
    );
    const platformFee = calculatePlatformFee(campaign.satsPerImpact);

    if (paymentStatus.settled) {
      await this.impactsService.completeImpact(impact.id, {
        status: ImpactStatus.FULL_SUCCESS,
        satsCharged:
          campaign.satsPerImpact + platformFee + (paymentStatus.feesPaid ?? 0),
        platformFee,
        preimage: paymentStatus.preimage,
      });
      return;
    }

    await this.impactsService.completeImpact(impact.id, {
      status: ImpactStatus.COMMENT_ONLY,
      satsCharged: platformFee,
      platformFee,
    });
  }

  private buildPromotionalComment(
    campaignName: string,
    productDescription: string,
  ): string {
    return `${campaignName}: ${productDescription}`;
  }
}
