import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Campaign } from './entities/campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CryptoService } from 'src/crypto/crypto.service';
import { Impact } from 'src/impacts/entities/impact.entity';
import { CampaignCommentMode } from './entities/campaign.entity';
import { NWCClient } from '@getalby/sdk';

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

  it('should persist promotional comment settings when creating a campaign', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const dto = {
      name: 'Test campaign',
      productDescription: 'Wallet segura',
      promotionalComment: 'Prueba esta wallet segura.',
      commentMode: CampaignCommentMode.AI,
      keywords: ['wallet'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 100,
      endsAt: futureDate,
    };

    campaignsRepository.create.mockImplementation((input) => input);
    campaignsRepository.save.mockImplementation((input) =>
      Promise.resolve({ id: 'campaign-1', ...input }),
    );

    await service.create(dto, 'company-id');

    expect(campaignsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionalComment: dto.promotionalComment,
        commentMode: CampaignCommentMode.AI,
      }),
    );
  });

  it('should reject the campaign when NWC balance info discovery fails', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const dto = {
      name: 'Test campaign',
      productDescription: 'Wallet segura',
      promotionalComment: 'Prueba esta wallet segura.',
      commentMode: CampaignCommentMode.FIXED,
      keywords: ['wallet'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 100,
      endsAt: futureDate,
    };

    const NWCClientMock = NWCClient as unknown as jest.Mock;
    NWCClientMock.mockImplementationOnce(() => ({
      getBalance: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Failed to request get_balance Error: no info event (kind 13194) returned from relay',
          ),
        ),
      close: jest.fn(),
    }));
    await expect(service.create(dto, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
    expect(campaignsRepository.create).not.toHaveBeenCalled();
    expect(campaignsRepository.save).not.toHaveBeenCalled();
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
        promotionalComment: 'Prueba Wallet Bitcoin.',
        commentMode: CampaignCommentMode.FIXED,
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
        promotionalComment: 'Prueba Wallet Bitcoin.',
        commentMode: CampaignCommentMode.FIXED,
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
      promotionalComment: 'Prueba Wallet Bitcoin.',
      commentMode: CampaignCommentMode.FIXED,
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
        commentContent: 'Prueba Wallet Bitcoin.',
        commentEventId: 'comment-1',
        foundKeywords: ['wallet'],
        status: 'full_success',
        zapSats: 100,
        lightningFeeSats: 1,
        platformFee: 2,
        totalSpentSats: 103,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    await expect(
      service.findOneForCompany('campaign-1', 'company-1'),
    ).resolves.toEqual(
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
            commentContent: 'Prueba Wallet Bitcoin.',
            commentEventId: 'comment-1',
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
