import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Campaign } from './entities/campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CryptoService } from 'src/crypto/crypto.service';

jest.mock('@getalby/sdk', () => ({
  NWCClient: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue({ balance: 1000 }),
    close: jest.fn(),
  })),
}));

describe('CampaignsService', () => {
  let service: CampaignsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: getRepositoryToken(Campaign),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
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
      description: 'desc',
      keywords: ['a'],
      nwcUrl: 'nostr+walletconnect://test',
      satsPerImpact: 10,
      endsAt: new Date(Date.now() - 1000).toISOString(),
    };

    await expect(service.create(dto as any, 'company-id')).rejects.toThrow(
      BadRequestException,
    );
  });
});
