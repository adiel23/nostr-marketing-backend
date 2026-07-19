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
import { BudgetExceededException } from 'src/impacts/impacts.service';
import { CampaignStatus } from 'src/campaigns/entities/campaign.entity';
import type { SendZapInput, ZapResult } from 'src/wallet/wallet.service';

describe('ImpactExecutionService', () => {
  let service: ImpactExecutionService;

  const campaignsService = {
    findById: jest.fn(),
  };
  const impactsService = {
    reserveImpact: jest.fn(),
    completeImpact: jest.fn(),
    recordPaymentAttempt: jest.fn(),
    findStalePending: jest.fn(),
  };
  const nostrPublisher = {
    publishComment: jest.fn(),
  };
  const walletService = {
    sendZap: jest.fn<Promise<ZapResult>, [SendZapInput]>(),
    checkPaymentStatus: jest.fn(),
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
    walletService.sendZap.mockResolvedValue({
      success: true,
      feesPaid: 1,
      preimage: 'preimage-abc',
      receiptVerified: true,
    });

    const result = await service.executeApprovedImpact(jobData);

    expect(nostrPublisher.publishComment).toHaveBeenCalledWith({
      targetEventId: jobData.eventId,
      targetPubkey: jobData.pubkey,
      content: 'Wallet Bitcoin: Wallet segura',
    });
    const [sendZapArgs] = walletService.sendZap.mock.calls[0];
    expect(sendZapArgs).toMatchObject({
      encryptedNwcUrl: campaign.nwcUrlEncrypted,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      amountSats: campaign.satsPerImpact,
    });
    expect(typeof sendZapArgs.onInvoiceReady).toBe('function');
    expect(impactsService.reserveImpact).toHaveBeenCalledWith({
      campaignId: campaign.id,
      targetPubkey: jobData.pubkey,
      targetEventId: jobData.eventId,
      reserveSats: 103,
    });
    expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-1', {
      status: ImpactStatus.FULL_SUCCESS,
      satsCharged: 103,
      platformFee: 2,
      commentEventId: 'comment-1',
      preimage: 'preimage-abc',
    });
    expect(result.status).toBe(ImpactStatus.FULL_SUCCESS);
    expect(result.zapSent).toBe(true);
  });

  it('registra la invoice y el hash de pago antes de invocar payInvoice', async () => {
    walletService.sendZap.mockImplementation(async (input) => {
      await input.onInvoiceReady?.({
        bolt11: 'lnbc1...',
        paymentHash: 'hash-abc',
      });
      return {
        success: true,
        feesPaid: 1,
        preimage: 'preimage-abc',
        receiptVerified: true,
      };
    });

    await service.executeApprovedImpact(jobData);

    expect(impactsService.recordPaymentAttempt).toHaveBeenCalledWith(
      'impact-1',
      { bolt11: 'lnbc1...', paymentHash: 'hash-abc' },
    );
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
      commentEventId: 'comment-1',
      preimage: undefined,
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

  it('no publica ni paga cuando el presupuesto de la campaña esta agotado', async () => {
    impactsService.reserveImpact.mockRejectedValue(
      new BudgetExceededException(),
    );

    await expect(service.executeApprovedImpact(jobData)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(nostrPublisher.publishComment).not.toHaveBeenCalled();
    expect(walletService.sendZap).not.toHaveBeenCalled();
  });

  it('no repite efectos externos cuando la reserva ya existe', async () => {
    impactsService.reserveImpact.mockResolvedValue({
      impact: {
        id: 'impact-1',
        status: ImpactStatus.FULL_SUCCESS,
        commentEventId: 'previous-comment-id',
      },
      reserved: false,
    });

    const result = await service.executeApprovedImpact(jobData);

    expect(result.zapSent).toBe(true);
    expect(result.commentEventId).toBe('previous-comment-id');
    expect(nostrPublisher.publishComment).not.toHaveBeenCalled();
    expect(walletService.sendZap).not.toHaveBeenCalled();
  });

  describe('reconcileStalePendingImpacts', () => {
    it('cierra como comment_only un pending sin intento de pago registrado', async () => {
      impactsService.findStalePending.mockResolvedValue([
        { id: 'impact-2', campaignId: campaign.id, paymentHash: null },
      ]);

      await service.reconcileStalePendingImpacts();

      expect(walletService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-2', {
        status: ImpactStatus.COMMENT_ONLY,
        satsCharged: 2,
        platformFee: 2,
      });
    });

    it('cierra como full_success un pending cuyo pago quedo liquidado en la wallet', async () => {
      impactsService.findStalePending.mockResolvedValue([
        { id: 'impact-3', campaignId: campaign.id, paymentHash: 'hash-abc' },
      ]);
      walletService.checkPaymentStatus.mockResolvedValue({
        settled: true,
        feesPaid: 1,
        preimage: 'preimage-xyz',
      });

      await service.reconcileStalePendingImpacts();

      expect(walletService.checkPaymentStatus).toHaveBeenCalledWith(
        campaign.nwcUrlEncrypted,
        'hash-abc',
      );
      expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-3', {
        status: ImpactStatus.FULL_SUCCESS,
        satsCharged: 103,
        platformFee: 2,
        preimage: 'preimage-xyz',
      });
    });

    it('cierra como comment_only un pending cuyo pago no se liquido', async () => {
      impactsService.findStalePending.mockResolvedValue([
        { id: 'impact-4', campaignId: campaign.id, paymentHash: 'hash-abc' },
      ]);
      walletService.checkPaymentStatus.mockResolvedValue({ settled: false });

      await service.reconcileStalePendingImpacts();

      expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-4', {
        status: ImpactStatus.COMMENT_ONLY,
        satsCharged: 2,
        platformFee: 2,
      });
    });

    it('cierra como comment_only sin cargo si la campaña ya no existe', async () => {
      impactsService.findStalePending.mockResolvedValue([
        {
          id: 'impact-5',
          campaignId: 'missing-campaign',
          paymentHash: 'hash-abc',
        },
      ]);
      campaignsService.findById.mockResolvedValue(null);

      await service.reconcileStalePendingImpacts();

      expect(walletService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(impactsService.completeImpact).toHaveBeenCalledWith('impact-5', {
        status: ImpactStatus.COMMENT_ONLY,
        satsCharged: 0,
        platformFee: 0,
      });
    });
  });
});
