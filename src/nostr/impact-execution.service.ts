import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { calculatePlatformFee } from 'src/common/fees.util';
import { CampaignJobData } from './nostr.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import { ImpactStatus } from 'src/impacts/entities/impact.entity';
import { ImpactsService } from 'src/impacts/impacts.service';

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
  ) {}

  async executeApprovedImpact(jobData: CampaignJobData): Promise<ImpactExecutionResult> {
    const existingImpact = await this.impactsService.findByTargetEventId(jobData.eventId);
    if (existingImpact) {
      this.logger.warn(`Impacto ya registrado para evento ${jobData.eventId}`);
      return {
        status: existingImpact.status,
        impactId: existingImpact.id,
        commentEventId: jobData.eventId,
        zapSent: existingImpact.status === ImpactStatus.FULL_SUCCESS,
      };
    }

    const alreadyImpacted = await this.impactsService.hasImpactForUser(
      jobData.campaignId,
      jobData.pubkey,
    );
    if (alreadyImpacted) {
      throw new Error(
        `El usuario ${jobData.pubkey} ya fue impactado por la campaña ${jobData.campaignId}`,
      );
    }

    const campaign = await this.campaignsService.findById(jobData.campaignId);
    if (!campaign) {
      throw new NotFoundException(`Campaña ${jobData.campaignId} no encontrada`);
    }

    const platformFee = calculatePlatformFee(campaign.satsPerImpact);
    const promotionalContent = this.buildPromotionalComment(
      campaign.name,
      campaign.productDescription,
    );

    const { eventId: commentEventId } = await this.nostrPublisher.publishComment({
      targetEventId: jobData.eventId,
      targetPubkey: jobData.pubkey,
      content: promotionalContent,
    });

    const zapResult = await this.walletService.sendZap({
      encryptedNwcUrl: campaign.nwcUrlEncrypted,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      amountSats: campaign.satsPerImpact,
    });

    const status =
      zapResult.success ? ImpactStatus.FULL_SUCCESS : ImpactStatus.COMMENT_ONLY;

    const satsCharged = zapResult.success
      ? campaign.satsPerImpact + platformFee + zapResult.feesPaid
      : platformFee;

    const impact = await this.impactsService.createImpact({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      status,
      satsCharged,
      platformFee,
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

  private buildPromotionalComment(campaignName: string, productDescription: string): string {
    return `${campaignName}: ${productDescription}`;
  }
}
