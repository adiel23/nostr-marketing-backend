import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CryptoService } from 'src/crypto/crypto.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { NWCClient } from '@getalby/sdk';

jest.mock('@getalby/sdk', () => ({
  NWCClient: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue({ balance: 1_000_000 }),
    close: jest.fn(),
  })),
}));

describe('CampaignsService', () => {
  let service: CampaignsService;
  const campaignsRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: getRepositoryToken(Campaign),
          useValue: campaignsRepository,
        },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn().mockReturnValue('encrypted-url'),
            decrypt: jest.fn().mockReturnValue('nostr+walletconnect://test'),
          },
        },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject campaigns whose end date is not after the creation date', async () => {
    const dto: CreateCampaignDto = {
      name: 'Test campaign',
      productDescription: 'Description',
      keywords: ['a'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 10,
      endsAt: new Date(Date.now() - 1000).toISOString(),
    };

    await expect(service.create(dto, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('limits a campaign end date to 30 days after activation', async () => {
    const dto = {
      name: 'Test campaign',
      productDescription: 'Description',
      keywords: ['a'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 10,
      endsAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await expect(service.create(dto, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('compares the NIP-47 balance in msats', async () => {
    (NWCClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 10_229 }),
      close: jest.fn(),
    }));

    const dto: CreateCampaignDto = {
      name: 'Test campaign',
      productDescription: 'Description',
      keywords: ['wallet'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 10,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(service.create(dto, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a zero sat impact before connecting to the wallet', async () => {
    const dto: CreateCampaignDto = {
      name: 'Test campaign',
      productDescription: 'Description',
      keywords: ['wallet'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 0,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(service.create(dto, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('scopes reads to the authenticated company', async () => {
    campaignsRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne('campaign-id', 'company-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(campaignsRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'campaign-id', companyId: 'company-a' },
    });
  });

  it('pauses, resumes, and cancels only an owned non-expired campaign', async () => {
    const campaign = {
      id: 'campaign-id',
      companyId: 'company-a',
      status: CampaignStatus.ACTIVE,
      endsAt: new Date(Date.now() + 60_000),
    } as Campaign;
    campaignsRepository.findOne.mockResolvedValue(campaign);
    campaignsRepository.save.mockImplementation((value: Campaign) =>
      Promise.resolve(value),
    );

    await expect(
      service.pause(campaign.id, campaign.companyId),
    ).resolves.toMatchObject({
      status: CampaignStatus.PAUSED,
    });
    await expect(
      service.resume(campaign.id, campaign.companyId),
    ).resolves.toMatchObject({
      status: CampaignStatus.ACTIVE,
    });
    await expect(
      service.remove(campaign.id, campaign.companyId),
    ).resolves.toMatchObject({
      status: CampaignStatus.CANCELLED,
    });

    await expect(
      service.resume(campaign.id, campaign.companyId),
    ).rejects.toThrow(ConflictException);
  });

  it('closes active and paused campaigns whose end time has elapsed', async () => {
    const now = new Date();

    await service.closeExpiredCampaigns(now);

    expect(campaignsRepository.update).toHaveBeenCalledWith(expect.anything(), {
      status: CampaignStatus.COMPLETED,
    });
  });
});
