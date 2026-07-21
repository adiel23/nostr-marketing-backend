import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Campaign } from './entities/campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CryptoService } from 'src/crypto/crypto.service';
import { Impact } from 'src/impacts/entities/impact.entity';

jest.mock('@getalby/sdk', () => ({
  NWCClient: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue({ balance: 1000 }),
    close: jest.fn(),
  })),
}));

describe('CampaignsService', () => {
  let service: CampaignsService;
  let campaignsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let impactsRepository: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    campaignsRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    impactsRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: getRepositoryToken(Campaign),
          useValue: campaignsRepository,
        },
        {
          provide: getRepositoryToken(Impact),
          useValue: impactsRepository,
        },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn().mockReturnValue('encrypted-url'),
          },
        },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject campaigns whose end date is not after the creation date', async () => {
    const dto = {
      name: 'Test campaign',
      keywords: ['a'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 10,
      endsAt: new Date(Date.now() - 1000).toISOString(),
    };

    await expect(service.create(dto as any, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should list only campaigns for the authenticated company with totals', async () => {
    const campaigns = [
      {
        id: 'campaign-1',
        companyId: 'company-1',
        name: 'Wallet',
        productDescription: 'Wallet segura',
        keywords: ['wallet'],
        satsPerImpact: 100,
        status: 'active',
        endsAt: new Date('2030-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          campaignId: 'campaign-1',
          impactsCount: '2',
          totalZapSats: '200',
          totalLightningFeeSats: '3',
          totalPlatformFeeSats: '4',
          totalSpentSats: '207',
        },
      ]),
    };

    campaignsRepository.find.mockResolvedValue(campaigns);
    impactsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findAllForCompany('company-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'campaign-1',
        impactsCount: 2,
        totalZapSats: 200,
        totalLightningFeeSats: 3,
        totalPlatformFeeSats: 4,
        totalSpentSats: 207,
      }),
    ]);
    expect(campaignsRepository.find).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('should return campaign detail with impact spend breakdown', async () => {
    campaignsRepository.findOne.mockResolvedValue({
      id: 'campaign-1',
      companyId: 'company-1',
      name: 'Wallet',
      productDescription: 'Wallet segura',
      keywords: ['wallet'],
      satsPerImpact: 100,
      status: 'active',
      endsAt: new Date('2030-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    impactsRepository.find.mockResolvedValue([
      {
        id: 'impact-1',
        campaignId: 'campaign-1',
        targetPubkey: 'pubkey-1',
        targetEventId: 'event-1',
        targetContent: 'Busco wallet',
        foundKeywords: ['wallet'],
        status: 'full_success',
        zapSats: 100,
        lightningFeeSats: 1,
        platformFee: 2,
        totalSpentSats: 103,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    await expect(service.findOneForCompany('campaign-1', 'company-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'campaign-1',
        impactsCount: 1,
        totalZapSats: 100,
        totalLightningFeeSats: 1,
        totalPlatformFeeSats: 2,
        totalSpentSats: 103,
        impacts: [
          expect.objectContaining({
            targetContent: 'Busco wallet',
            foundKeywords: ['wallet'],
            zapSats: 100,
            lightningFeeSats: 1,
            platformFee: 2,
            totalSpentSats: 103,
          }),
        ],
      }),
    );
    expect(campaignsRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'campaign-1', companyId: 'company-1' },
    });
  });
});
