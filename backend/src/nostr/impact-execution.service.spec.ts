jest.mock('./nostr.publisher', () => ({ NostrPublisher: class {} }));
jest.mock('src/wallet/wallet.service', () => ({ WalletService: class {} }));
jest.mock('src/llm/llm.service', () => ({ LlmService: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ImpactExecutionService } from './impact-execution.service';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { ImpactsService } from 'src/impacts/impacts.service';
import { NostrPublisher } from './nostr.publisher';
import { WalletService } from 'src/wallet/wallet.service';
import {
  CommentStatus,
  ImpactStatus,
  PaymentProgressStatus,
} from 'src/impacts/entities/impact.entity';
import {
  CampaignCommentMode,
  CampaignStatus,
} from 'src/campaigns/entities/campaign.entity';
import { LlmService } from 'src/llm/llm.service';
import { ImpactPaymentType } from 'src/impacts/entities/impact-payment.entity';

describe('ImpactExecutionService', () => {
  let service: ImpactExecutionService;

  const campaignsService = {
    findById: jest.fn(),
    markBillingBlocked: jest.fn(),
    restoreAfterBilling: jest.fn(),
  };
  const impactsService = {
    findRecoverable: jest.fn(),
    findOrCreateProcessing: jest.fn(),
    getPayment: jest.fn(),
    ensurePayment: jest.fn(),
    savePreparedComment: jest.fn(),
    savePaymentInvoice: jest.fn(),
    markFundsInsufficient: jest.fn(),
    markCommentPublished: jest.fn(),
    markFailedBeforeComment: jest.fn(),
    recordPaymentFailure: jest.fn(),
    markFeePending: jest.fn(),
    markPaymentPaid: jest.fn(),
    markPaymentSkipped: jest.fn(),
    markCompleted: jest.fn(),
  };
  const nostrPublisher = {
    prepareComment: jest.fn(),
    publishPreparedComment: jest.fn(),
  };
  const walletService = {
    createPlatformFeeInvoice: jest.fn(),
    getAdvertiserBalanceMsats: jest.fn(),
    payAdvertiserInvoice: jest.fn(),
    isPlatformInvoicePaid: jest.fn(),
    getPlatformInvoiceState: jest.fn(),
    prepareZap: jest.fn(),
  };
  const llmService = { generatePromotionalComment: jest.fn() };

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
    promotionalComment: 'Prueba Wallet Bitcoin para pagos seguros.',
    commentMode: CampaignCommentMode.FIXED,
    nwcUrlEncrypted: 'encrypted-url',
    satsPerImpact: 100,
    status: CampaignStatus.ACTIVE,
  };
  const signedComment = {
    id: 'comment-1',
    pubkey: 'platform',
    created_at: 1,
    kind: 1,
    tags: [],
    content: campaign.promotionalComment,
    sig: 'signature',
  };
  const draftImpact = {
    id: 'impact-1',
    status: ImpactStatus.PROCESSING,
    commentStatus: CommentStatus.PENDING,
    platformFeeStatus: PaymentProgressStatus.PENDING,
    zapStatus: PaymentProgressStatus.PENDING,
    signedComment: null,
    commentContent: null,
    commentEventId: null,
  };
  const platformPayment = {
    id: 'payment-fee',
    type: ImpactPaymentType.PLATFORM_FEE,
    status: PaymentProgressStatus.PENDING,
    amountMsats: '2000',
    invoice: null,
    paymentHash: null,
  };
  const zapPayment = {
    id: 'payment-zap',
    type: ImpactPaymentType.ZAP,
    status: PaymentProgressStatus.PENDING,
    amountMsats: '100000',
    invoice: null,
    paymentHash: null,
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
        { provide: LlmService, useValue: llmService },
      ],
    }).compile();
    service = module.get(ImpactExecutionService);

    campaignsService.findById.mockResolvedValue(campaign);
    impactsService.findOrCreateProcessing.mockResolvedValue({ ...draftImpact });
    impactsService.getPayment.mockResolvedValue(null);
    impactsService.ensurePayment.mockImplementation(
      (_impactId: string, type: ImpactPaymentType) =>
        Promise.resolve(
          type === ImpactPaymentType.PLATFORM_FEE
            ? { ...platformPayment }
            : { ...zapPayment },
        ),
    );
    nostrPublisher.prepareComment.mockReturnValue(signedComment);
    nostrPublisher.publishPreparedComment.mockResolvedValue({
      eventId: signedComment.id,
    });
    walletService.createPlatformFeeInvoice.mockResolvedValue({
      invoice: 'fee-invoice',
      paymentHash: 'fee-hash',
    });
    walletService.getAdvertiserBalanceMsats.mockResolvedValue(200_000n);
    walletService.payAdvertiserInvoice.mockResolvedValue({
      success: true,
      feesPaidMsats: '500',
      preimage: 'preimage',
    });
    walletService.prepareZap.mockResolvedValue({
      success: true,
      invoice: 'zap-invoice',
    });
    walletService.isPlatformInvoicePaid.mockResolvedValue(false);
    walletService.getPlatformInvoiceState.mockResolvedValue('pending');
  });

  it('publica, cobra el fee y después paga el Zap', async () => {
    const result = await service.executeApprovedImpact(jobData);

    expect(
      walletService.getAdvertiserBalanceMsats.mock.invocationCallOrder[0],
    ).toBeLessThan(
      nostrPublisher.publishPreparedComment.mock.invocationCallOrder[0],
    );
    expect(walletService.payAdvertiserInvoice).toHaveBeenNthCalledWith(
      1,
      campaign.nwcUrlEncrypted,
      'fee-invoice',
    );
    expect(walletService.payAdvertiserInvoice).toHaveBeenNthCalledWith(
      2,
      campaign.nwcUrlEncrypted,
      'zap-invoice',
    );
    expect(impactsService.markPaymentPaid).toHaveBeenCalledWith(
      'payment-fee',
      '500',
      'preimage',
    );
    expect(impactsService.markCompleted).toHaveBeenCalledWith('impact-1', true);
    expect(result).toEqual(
      expect.objectContaining({
        status: ImpactStatus.FULL_SUCCESS,
        zapSent: true,
      }),
    );
  });

  it('no publica ni cobra cuando falta saldo para el impacto completo', async () => {
    walletService.getAdvertiserBalanceMsats.mockResolvedValue(103_999n);

    const result = await service.executeApprovedImpact(jobData);

    expect(result.status).toBe(ImpactStatus.FUNDS_INSUFFICIENT);
    expect(impactsService.markFundsInsufficient).toHaveBeenCalledWith(
      'impact-1',
    );
    expect(nostrPublisher.publishPreparedComment).not.toHaveBeenCalled();
    expect(walletService.payAdvertiserInvoice).not.toHaveBeenCalled();
  });

  it('no publica y bloquea la campaña cuando la wallet de plataforma no responde', async () => {
    walletService.createPlatformFeeInvoice.mockRejectedValue(
      new Error('no info event (kind 13194) returned from relay'),
    );

    await expect(service.executeApprovedImpact(jobData)).rejects.toThrow(
      'no info event',
    );
    expect(campaignsService.markBillingBlocked).toHaveBeenCalledWith(
      'campaign-1',
    );
    expect(nostrPublisher.publishPreparedComment).not.toHaveBeenCalled();
    expect(walletService.payAdvertiserInvoice).not.toHaveBeenCalled();
  });

  it('cobra el fee aunque el usuario no pueda recibir el Zap', async () => {
    walletService.prepareZap.mockResolvedValue({
      success: false,
      reason: 'no_lightning',
      message: 'Sin Lightning Address',
    });

    const result = await service.executeApprovedImpact(jobData);

    expect(impactsService.markPaymentPaid).toHaveBeenCalledWith(
      'payment-fee',
      '500',
      'preimage',
    );
    expect(impactsService.markPaymentSkipped).toHaveBeenCalledWith(
      'payment-zap',
      'no_lightning',
      'Sin Lightning Address',
    );
    expect(impactsService.markCompleted).toHaveBeenCalledWith(
      'impact-1',
      false,
    );
    expect(result.status).toBe(ImpactStatus.COMMENT_ONLY);
  });

  it('deja el fee pendiente, bloquea la campaña y no intenta el Zap', async () => {
    walletService.payAdvertiserInvoice.mockResolvedValueOnce({
      success: false,
      reason: 'payment_failed',
      message: 'Sin ruta',
    });

    await expect(service.executeApprovedImpact(jobData)).rejects.toThrow(
      'Fee de plataforma pendiente',
    );
    expect(impactsService.markFeePending).toHaveBeenCalledWith('impact-1');
    expect(campaignsService.markBillingBlocked).toHaveBeenCalledWith(
      'campaign-1',
    );
    expect(walletService.prepareZap).not.toHaveBeenCalled();
  });

  it('usa 5% en msats para un comentario generado por IA', async () => {
    campaignsService.findById.mockResolvedValue({
      ...campaign,
      commentMode: CampaignCommentMode.AI,
    });
    llmService.generatePromotionalComment.mockResolvedValue({
      content: 'Comentario generado',
    });

    await service.executeApprovedImpact(jobData);

    expect(impactsService.ensurePayment).toHaveBeenCalledWith(
      'impact-1',
      ImpactPaymentType.PLATFORM_FEE,
      '5000',
    );
  });

  it('continúa un fee pendiente sin volver a publicar el comentario', async () => {
    impactsService.findOrCreateProcessing.mockResolvedValue({
      ...draftImpact,
      status: ImpactStatus.FEE_PENDING,
      commentStatus: CommentStatus.PUBLISHED,
      signedComment,
      commentEventId: signedComment.id,
    });
    impactsService.getPayment.mockResolvedValue({
      ...platformPayment,
      status: PaymentProgressStatus.RETRYING,
      invoice: 'fee-invoice',
      paymentHash: 'fee-hash',
    });

    await service.executeApprovedImpact(jobData);

    expect(nostrPublisher.prepareComment).not.toHaveBeenCalled();
    expect(nostrPublisher.publishPreparedComment).not.toHaveBeenCalled();
    expect(campaignsService.restoreAfterBilling).toHaveBeenCalledWith(
      'campaign-1',
    );
  });

  it('no hace efectos externos cuando la campaña no existe', async () => {
    campaignsService.findById.mockResolvedValue(null);
    await expect(service.executeApprovedImpact(jobData)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
