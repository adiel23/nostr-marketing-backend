import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NWCClient } from '@getalby/sdk';
import { Campaign, CampaignCommentMode } from './entities/campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CryptoService } from 'src/crypto/crypto.service';
import {
  CommentStatus,
  Impact,
  ImpactStatus,
  PaymentProgressStatus,
} from 'src/impacts/entities/impact.entity';
import {
  ImpactPayment,
  ImpactPaymentType,
} from 'src/impacts/entities/impact-payment.entity';

const nwcDefaults = () => ({
  getWalletServiceInfo: jest.fn().mockResolvedValue({
    capabilities: ['get_balance', 'pay_invoice', 'lookup_invoice'],
  }),
  getBalance: jest.fn().mockResolvedValue({ balance: 1_000_000 }),
  close: jest.fn(),
});

jest.mock('@getalby/sdk', () => ({
  NWCClient: jest.fn().mockImplementation(() => nwcDefaults()),
}));

describe('CampaignsService', () => {
  let service: CampaignsService;
  let campaignsRepository: any;
  let impactsRepository: any;
  let paymentsRepository: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    campaignsRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    impactsRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    paymentsRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: getRepositoryToken(Campaign),
          useValue: campaignsRepository,
        },
        { provide: getRepositoryToken(Impact), useValue: impactsRepository },
        {
          provide: getRepositoryToken(ImpactPayment),
          useValue: paymentsRepository,
        },
        {
          provide: CryptoService,
          useValue: { encrypt: jest.fn().mockReturnValue('encrypted-url') },
        },
      ],
    }).compile();
    service = module.get(CampaignsService);
  });

  const campaignDto = (commentMode = CampaignCommentMode.FIXED) => ({
    name: 'Test campaign',
    productDescription: 'Wallet segura',
    promotionalComment: 'Prueba esta wallet segura.',
    commentMode,
    keywords: ['wallet'],
    nwcUrl: 'nostr+walletconnect://test',
    satsPerImpact: 100,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
  });

  it('valida capacidades, balance completo en msats y guarda la campaña', async () => {
    campaignsRepository.create.mockImplementation((input: unknown) => input);
    campaignsRepository.save.mockImplementation((input: unknown) => input);

    await service.create(campaignDto(CampaignCommentMode.AI), 'company-id');

    const client = (NWCClient as unknown as jest.Mock).mock.results[0].value;
    expect(client.getWalletServiceInfo).toHaveBeenCalled();
    expect(client.getBalance).toHaveBeenCalled();
    expect(campaignsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMode: CampaignCommentMode.AI,
        nwcUrlEncrypted: 'encrypted-url',
      }),
    );
  });

  it('rechaza saldo menor al impacto completo estimado', async () => {
    (NWCClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      ...nwcDefaults(),
      getBalance: jest.fn().mockResolvedValue({ balance: 103_999 }),
    }));

    await expect(
      service.create(campaignDto(CampaignCommentMode.FIXED), 'company-id'),
    ).rejects.toThrow(BadRequestException);
    expect(campaignsRepository.save).not.toHaveBeenCalled();
  });

  it('rechaza conexiones sin los permisos NWC requeridos', async () => {
    (NWCClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      ...nwcDefaults(),
      getWalletServiceInfo: jest
        .fn()
        .mockResolvedValue({ capabilities: ['get_balance'] }),
    }));

    await expect(service.create(campaignDto(), 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lista totales exactos en msats', async () => {
    const campaign = {
      id: 'campaign-1',
      companyId: 'company-1',
      ...campaignDto(),
      status: 'active',
      createdAt: new Date(),
    };
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          campaignId: 'campaign-1',
          impactsCount: '2',
          totalZapAmountMsats: '200000',
          totalZapRoutingFeeMsats: '3000',
          totalPlatformFeeAmountMsats: '4000',
          totalPlatformRoutingFeeMsats: '1000',
          totalSpentMsats: '208000',
        },
      ]),
    };
    campaignsRepository.find.mockResolvedValue([campaign]);
    impactsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findAllForCompany('company-1')).resolves.toEqual([
      expect.objectContaining({
        impactsCount: 2,
        totalZapAmountMsats: '200000',
        totalPlatformFeeAmountMsats: '4000',
        totalSpentMsats: '208000',
      }),
    ]);
  });

  it('solo contabiliza pagos confirmados en el detalle', async () => {
    campaignsRepository.findOne.mockResolvedValue({
      id: 'campaign-1',
      companyId: 'company-1',
      ...campaignDto(),
      status: 'active',
      createdAt: new Date(),
    });
    impactsRepository.find.mockResolvedValue([
      {
        id: 'impact-1',
        campaignId: 'campaign-1',
        targetPubkey: 'pubkey-1',
        targetEventId: 'event-1',
        targetContent: 'Busco wallet',
        commentContent: 'Prueba Wallet Bitcoin.',
        commentEventId: 'comment-1',
        foundKeywords: ['wallet'],
        status: ImpactStatus.COMMENT_ONLY,
        commentStatus: CommentStatus.PUBLISHED,
        platformFeeStatus: PaymentProgressStatus.PAID,
        zapStatus: PaymentProgressStatus.SKIPPED,
        createdAt: new Date(),
      },
    ]);
    paymentsRepository.find.mockResolvedValue([
      {
        impactId: 'impact-1',
        type: ImpactPaymentType.ZAP,
        status: PaymentProgressStatus.SKIPPED,
        amountMsats: '100000',
        routingFeeMsats: '0',
      },
      {
        impactId: 'impact-1',
        type: ImpactPaymentType.PLATFORM_FEE,
        status: PaymentProgressStatus.PAID,
        amountMsats: '2000',
        routingFeeMsats: '500',
      },
    ]);

    await expect(
      service.findOneForCompany('campaign-1', 'company-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        totalZapAmountMsats: '0',
        totalPlatformFeeAmountMsats: '2000',
        totalPlatformRoutingFeeMsats: '500',
        totalSpentMsats: '2500',
        impacts: [
          expect.objectContaining({
            zapAmountMsats: '0',
            platformFeeAmountMsats: '2000',
            totalSpentMsats: '2500',
          }),
        ],
      }),
    );
  });
});
