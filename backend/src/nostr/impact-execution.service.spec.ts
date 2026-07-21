jest.mock('./nostr.publisher', () => ({
  NostrPublisher: jest.fn().mockImplementation(() => ({
    publishComment: jest.fn(),
  })),
}));

jest.mock('src/wallet/wallet.service', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    sendZap: jest.fn(),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ImpactExecutionService } from './impact-execution.service';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { ImpactsService } from 'src/impacts/impacts.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import { ImpactStatus } from 'src/impacts/entities/impact.entity';
import { CampaignStatus } from 'src/campaigns/entities/campaign.entity';

describe('ImpactExecutionService', () => {
  let service: ImpactExecutionService;

  const campaignsService = {
    findById: jest.fn(),
  };
  const impactsService = {
    findByTargetEventId: jest.fn(),
    hasImpactForUser: jest.fn(),
    createImpact: jest.fn(),
  };
  const nostrPublisher = {
    publishComment: jest.fn(),
  };
  const walletService = {
    sendZap: jest.fn(),
  };

  const jobData = {
    campaignId: 'campaign-1',
    campaignName: 'Wallet Bitcoin',
    productDescription: 'Wallet segura',
    foundKeywords: ['wallet'],
    eventId: 'event-1',
    pubkey: 'abc123',
    content: 'Busco wallet',
    createdAt: 123,
  };

  const campaign = {
    id: 'campaign-1',
    name: 'Wallet Bitcoin',
    productDescription: 'Wallet segura',
    nwcUrlEncrypted: 'encrypted-url',
    satsPerImpact: 100,
    status: CampaignStatus.ACTIVE,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpactExecutionService,
        { provide: CampaignsService, useValue: campaignsService },
        { provide: ImpactsService, useValue: impactsService },
        { provide: NostrPublisher, useValue: nostrPublisher },
        { provide: WalletService, useValue: walletService },
      ],
    }).compile();

    service = module.get(ImpactExecutionService);

    impactsService.findByTargetEventId.mockResolvedValue(null);
    impactsService.hasImpactForUser.mockResolvedValue(false);
    campaignsService.findById.mockResolvedValue(campaign);
    nostrPublisher.publishComment.mockResolvedValue({ eventId: 'comment-1' });
    impactsService.createImpact.mockImplementation((input) =>
      Promise.resolve({ id: 'impact-1', ...input }),
    );
  });

  it('registra full_success cuando el zap se procesa correctamente', async () => {
    walletService.sendZap.mockResolvedValue({ success: true, feesPaid: 1 });

    const result = await service.executeApprovedImpact(jobData);

    expect(nostrPublisher.publishComment).toHaveBeenCalledWith({
      targetEventId: jobData.eventId,
      targetPubkey: jobData.pubkey,
      content: 'Wallet Bitcoin: Wallet segura',
    });
    expect(walletService.sendZap).toHaveBeenCalledWith({
      encryptedNwcUrl: campaign.nwcUrlEncrypted,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      amountSats: campaign.satsPerImpact,
    });
    expect(impactsService.createImpact).toHaveBeenCalledWith({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      targetContent: jobData.content,
      foundKeywords: jobData.foundKeywords,
      status: ImpactStatus.FULL_SUCCESS,
      satsCharged: 103,
      zapSats: 100,
      lightningFeeSats: 1,
      platformFee: 2,
      totalSpentSats: 103,
    });
    expect(result.status).toBe(ImpactStatus.FULL_SUCCESS);
    expect(result.zapSent).toBe(true);
  });

  it('registra comment_only cuando el zap falla', async () => {
    walletService.sendZap.mockResolvedValue({
      success: false,
      reason: 'no_lightning',
      message: 'Sin Lightning Address',
    });

    const result = await service.executeApprovedImpact(jobData);

    expect(impactsService.createImpact).toHaveBeenCalledWith({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      targetContent: jobData.content,
      foundKeywords: jobData.foundKeywords,
      status: ImpactStatus.COMMENT_ONLY,
      satsCharged: 2,
      zapSats: 0,
      lightningFeeSats: 0,
      platformFee: 2,
      totalSpentSats: 2,
    });
    expect(result.status).toBe(ImpactStatus.COMMENT_ONLY);
    expect(result.zapSent).toBe(false);
  });

  it('lanza error si la campaña no existe', async () => {
    campaignsService.findById.mockResolvedValue(null);

    await expect(service.executeApprovedImpact(jobData)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
