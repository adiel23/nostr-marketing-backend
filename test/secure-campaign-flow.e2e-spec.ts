import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { Campaign } from 'src/campaigns/entities/campaign.entity';
import { Impact, ImpactStatus } from 'src/impacts/entities/impact.entity';
import type {
  EvaluateIntentInput,
  EvaluateIntentResult,
} from 'src/llm/llm.service';
import type {
  PublishCommentInput,
  PublishCommentResult,
} from 'src/nostr/nostr.publisher';
import { NostrService } from 'src/nostr/nostr.service';
import type { SendZapInput, ZapResult } from 'src/wallet/wallet.service';

const mockPublishComment = jest.fn<
  Promise<PublishCommentResult>,
  [PublishCommentInput]
>();
const mockSendZap = jest.fn<Promise<ZapResult>, [SendZapInput]>();
const mockEvaluateIntent = jest.fn<
  Promise<EvaluateIntentResult>,
  [EvaluateIntentInput]
>();

jest.mock('@getalby/sdk', () => ({
  NWCClient: class {
    getBalance() {
      return Promise.resolve({ balance: 10_000_000 });
    }

    close() {}
  },
}));

jest.mock('ws', () => {
  class MockWebSocket {
    static readonly OPEN = 1;
    readonly readyState = MockWebSocket.OPEN;

    on() {
      return this;
    }

    send() {}

    close() {}
  }

  return { __esModule: true, default: MockWebSocket };
});

jest.mock('nostr-tools/pure', () => ({
  verifyEvent: () => true,
}));

jest.mock('src/nostr/nostr-keys.util', () => ({
  getPlatformSecretKey: () => new Uint8Array(32),
  getPlatformPublicKey: () => 'c'.repeat(64),
  getRelayUrl: () => 'ws://nostr-e2e.invalid',
}));

jest.mock('src/nostr/nostr.publisher', () => ({
  NostrPublisher: class {
    publishComment(input: PublishCommentInput): Promise<PublishCommentResult> {
      return mockPublishComment(input);
    }
  },
}));

jest.mock('src/wallet/wallet.service', () => ({
  WalletService: class {
    sendZap(input: SendZapInput): Promise<ZapResult> {
      return mockSendZap(input);
    }
  },
}));

jest.mock('src/llm/llm.service', () => ({
  LlmService: class {
    evaluateIntent(input: EvaluateIntentInput): Promise<EvaluateIntentResult> {
      return mockEvaluateIntent(input);
    }
  },
}));

interface Account {
  id: string;
  accessToken: string;
}

function getRequiredString(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La respuesta E2E no contiene un objeto JSON.');
  }

  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`La respuesta E2E no contiene ${field}.`);
  }
  return value;
}

async function waitFor<T>(
  predicate: () => Promise<T | null>,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for E2E result.`);
}

describe('secure campaign flow (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let dataSource: DataSource;
  let nostrQueue: Queue;
  let nostrService: NostrService;
  const createdCompanyIds: string[] = [];

  async function createAccount(label: string): Promise<Account> {
    const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `${suffix}@example.test`;
    const company = await request(app!.getHttpServer())
      .post('/companies')
      .send({
        name: `Empresa ${label}`,
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    const id = getRequiredString(company.body, 'id');
    createdCompanyIds.push(id);

    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);

    return { id, accessToken: getRequiredString(login.body, 'access_token') };
  }

  beforeAll(async () => {
    mockPublishComment.mockImplementation((input) =>
      Promise.resolve({ eventId: `comment-${input.targetEventId}` }),
    );
    mockSendZap.mockImplementation(async (input) => {
      await input.onInvoiceReady?.({
        bolt11: 'lnbc1000n1psecurecampaignflow',
        paymentHash: 'payment-hash-secure-campaign-flow',
      });
      return {
        success: true,
        feesPaid: 1,
        preimage: 'preimage-secure-campaign-flow',
        receiptVerified: true,
      };
    });
    mockEvaluateIntent.mockResolvedValue({
      match: true,
      reason: 'Interes comercial confirmado por el simulador E2E.',
      confidence: 0.99,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = moduleFixture.get(DataSource);
    nostrQueue = moduleFixture.get<Queue>(getQueueToken('nostr-matches'));
    nostrService = moduleFixture.get(NostrService);
  });

  afterEach(async () => {
    while (createdCompanyIds.length > 0) {
      const companyId = createdCompanyIds.pop();
      if (companyId) {
        await dataSource.query('DELETE FROM companies WHERE id = $1', [
          companyId,
        ]);
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a campaign whose total budget cannot fund one impact', async () => {
    const owner = await createAccount('presupuesto');

    await request(app!.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Presupuesto insuficiente',
        productDescription: 'Campana de validacion de presupuesto.',
        keywords: ['presupuesto-e2e'],
        nwcUrl: 'nostr+walletconnect://e2e.invalid?relay=wss://93.184.216.34',
        satsPerImpact: 100,
        budgetSats: 102,
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(400);
  });

  it('keeps wallet details private and never spends beyond the campaign budget', async () => {
    const owner = await createAccount('propietario');
    const otherCompany = await createAccount('ajena');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const keyword = `budget-e2e-${suffix}`;
    mockPublishComment.mockClear();
    mockSendZap.mockClear();
    mockEvaluateIntent.mockClear();

    const campaignResponse = await request(app!.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Campana con limite estricto',
        productDescription: 'Promocion segura para una wallet Lightning.',
        keywords: [keyword],
        nwcUrl: 'nostr+walletconnect://e2e.invalid?relay=wss://93.184.216.34',
        satsPerImpact: 100,
        budgetSats: 103,
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const campaignId = getRequiredString(campaignResponse.body, 'id');
    expect(campaignResponse.body).not.toHaveProperty('nwcUrlEncrypted');

    await request(app!.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${otherCompany.accessToken}`)
      .expect(404);

    await nostrService.handleKeywordsSinking();
    const firstEvent = {
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: `Busco ${keyword} para mi negocio.`,
      sig: '3'.repeat(128),
    };
    await (
      nostrService as unknown as {
        handleRelayMessage(data: string): Promise<void>;
      }
    ).handleRelayMessage(JSON.stringify(['EVENT', 'secure-e2e', firstEvent]));

    const firstImpact = await waitFor(() =>
      dataSource.getRepository(Impact).findOne({
        where: { campaignId, targetEventId: firstEvent.id },
      }),
    );
    expect(firstImpact).toMatchObject({
      status: ImpactStatus.FULL_SUCCESS,
      reservedSats: 103,
      satsCharged: 103,
      platformFee: 2,
      bolt11: 'lnbc1000n1psecurecampaignflow',
      paymentHash: 'payment-hash-secure-campaign-flow',
      preimage: 'preimage-secure-campaign-flow',
      commentEventId: `comment-${firstEvent.id}`,
    });
    expect(mockSendZap).toHaveBeenCalledTimes(1);

    const campaignAfterFirstImpact = await dataSource
      .getRepository(Campaign)
      .findOneByOrFail({ id: campaignId });
    expect(campaignAfterFirstImpact).toMatchObject({
      budgetSats: 103,
      reservedSats: 0,
      spentSats: 103,
    });

    const secondEvent = {
      id: '4'.repeat(64),
      pubkey: '5'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: `Tambien necesito ${keyword} urgentemente.`,
      sig: '6'.repeat(128),
    };
    await (
      nostrService as unknown as {
        handleRelayMessage(data: string): Promise<void>;
      }
    ).handleRelayMessage(JSON.stringify(['EVENT', 'secure-e2e', secondEvent]));

    const secondJob = await waitFor(async () => {
      const job = await nostrQueue.getJob(
        `${campaignId}:${secondEvent.id}:match`,
      );
      if (!job || (await job.getState()) !== 'completed') return null;
      return job;
    });
    const campaignAfterSecondEvent = await dataSource
      .getRepository(Campaign)
      .findOneByOrFail({ id: campaignId });
    expect(campaignAfterSecondEvent).toMatchObject({
      budgetSats: 103,
      reservedSats: 0,
      spentSats: 103,
    });
    await expect(
      dataSource.getRepository(Impact).count({ where: { campaignId } }),
    ).resolves.toBe(1);
    expect(secondJob.returnvalue).toEqual({
      status: 'discarded',
      eventId: secondEvent.id,
    });
    expect(mockSendZap).toHaveBeenCalledTimes(1);
  });
});
