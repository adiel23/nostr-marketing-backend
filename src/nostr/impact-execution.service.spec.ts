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
import { ConflictException, NotFoundException } from '@nestjs/common';
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
    reserveImpact: jest.fn(),
    completeImpact: jest.fn(),
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
    endsAt: new Date(Date.now() + 60_000),
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

    campaignsService.findById.mockResolvedValue(campaign);
    nostrPublisher.publishComment.mockResolvedValue({ eventId: 'comment-1' });
    impactsService.reserveImpact.mockResolvedValue({
      impact: { id: 'impact-1', status: ImpactStatus.PENDING },
      reserved: true,
    });
    impactsService.completeImpact.mockImplementation(
      (id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id, ...input }),
    );
    campaign.status = CampaignStatus.ACTIVE;
    campaign.endsAt = new Date(Date.now() + 60_000);
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
    expect(impactsService.reserveImpact).toHaveBeenCalledWith({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
    });
    expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-1', {
      status: ImpactStatus.FULL_SUCCESS,
      satsCharged: 103,
      platformFee: 2,
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

    expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-1', {
      status: ImpactStatus.COMMENT_ONLY,
      satsCharged: 2,
      platformFee: 2,
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

  it('no publica ni paga una campaña pausada después de encolar el trabajo', async () => {
    campaign.status = CampaignStatus.PAUSED;

    await expect(service.executeApprovedImpact(jobData)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(nostrPublisher.publishComment).not.toHaveBeenCalled();
    expect(walletService.sendZap).not.toHaveBeenCalled();
  });

  it('no repite efectos externos cuando la reserva ya existe', async () => {
    impactsService.reserveImpact.mockResolvedValue({
      impact: { id: 'impact-1', status: ImpactStatus.FULL_SUCCESS },
      reserved: false,
    });

    const result = await service.executeApprovedImpact(jobData);

    expect(result.zapSent).toBe(true);
    expect(nostrPublisher.publishComment).not.toHaveBeenCalled();
    expect(walletService.sendZap).not.toHaveBeenCalled();
  });
});
