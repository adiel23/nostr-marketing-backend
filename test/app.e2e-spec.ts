import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { NostrService } from 'src/nostr/nostr.service';
import { Impact, ImpactStatus } from 'src/impacts/entities/impact.entity';
import type {
  EvaluateIntentInput,
  EvaluateIntentResult,
} from 'src/llm/llm.service';
import type {
  PublishCommentInput,
  PublishCommentResult,
} from 'src/nostr/nostr.publisher';
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

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let nostrQueue: Queue;
  let nostrService: NostrService;

  beforeAll(async () => {
    mockPublishComment.mockResolvedValue({ eventId: 'e2e-comment' });
    mockSendZap.mockResolvedValue({
      success: true,
      feesPaid: 1,
      preimage: 'e2e-preimage',
      receiptVerified: true,
    });
    mockEvaluateIntent.mockResolvedValue({
      match: true,
      reason: 'InterÃ©s comercial confirmado por el simulador E2E.',
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

  it('connects to PostgreSQL and Redis without a relay connection', async () => {
    await expect(dataSource.query('SELECT 1')).resolves.toEqual([
      { '?column?': 1 },
    ]);
    await expect(nostrQueue.waitUntilReady()).resolves.toBeDefined();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('crea una campaÃ±a y procesa un match hasta registrar el zap', async () => {
    const suffix = Date.now().toString();
    const email = `e2e-${suffix}@example.test`;
    const matchKeyword = `e2e-keyword-${suffix}`;
    mockPublishComment.mockClear();
    mockSendZap.mockClear();
    mockEvaluateIntent.mockClear();

    const companyResponse = await request(app.getHttpServer())
      .post('/companies')
      .send({
        name: 'Empresa E2E',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    expect(companyResponse.body).not.toHaveProperty('passwordHash');

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    const accessToken = getRequiredString(loginResponse.body, 'access_token');

    const campaignResponse = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Wallet E2E',
        productDescription: 'Una wallet para pagos Lightning seguros.',
        keywords: [matchKeyword],
        nwcUrl: 'nostr+walletconnect://e2e.invalid?relay=wss://93.184.216.34',
        satsPerImpact: 100,
        budgetSats: 1000,
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const campaignId = getRequiredString(campaignResponse.body, 'id');
    expect(campaignResponse.body).not.toHaveProperty('nwcUrlEncrypted');

    const listResponse = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const listBody = listResponse.body as Record<string, unknown>[];
    expect(listBody.length).toBeGreaterThan(0);
    for (const item of listBody) {
      expect(item).not.toHaveProperty('nwcUrlEncrypted');
    }

    const getOneResponse = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getOneResponse.body).not.toHaveProperty('nwcUrlEncrypted');

    await nostrService.handleKeywordsSinking();

    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: `Estoy buscando una wallet con ${matchKeyword} para mi negocio.`,
      sig: 'd'.repeat(128),
    };
    await (
      nostrService as unknown as {
        handleRelayMessage(data: string): Promise<void>;
      }
    ).handleRelayMessage(JSON.stringify(['EVENT', 'e2e-subscription', event]));

    const impact = await waitFor(() =>
      dataSource.getRepository(Impact).findOne({
        where: { campaignId, targetEventId: event.id },
      }),
    );

    expect(impact).toMatchObject({
      campaignId,
      targetPubkey: event.pubkey,
      targetEventId: event.id,
      status: ImpactStatus.FULL_SUCCESS,
      satsCharged: 103,
      platformFee: 2,
    });
    expect(mockEvaluateIntent).toHaveBeenCalledWith({
      postContent: event.content,
      campaignName: 'Wallet E2E',
      productDescription: 'Una wallet para pagos Lightning seguros.',
    });
    expect(mockPublishComment).toHaveBeenCalledWith({
      targetEventId: event.id,
      targetPubkey: event.pubkey,
      content: 'Wallet E2E: Una wallet para pagos Lightning seguros.',
    });
    const walletInput = mockSendZap.mock.calls[0]?.[0];
    expect(walletInput).toMatchObject({
      targetPubkey: event.pubkey,
      targetEventId: event.id,
      amountSats: 100,
    });
    expect(typeof walletInput?.encryptedNwcUrl).toBe('string');

    await (
      nostrService as unknown as {
        handleRelayMessage(data: string): Promise<void>;
      }
    ).handleRelayMessage(JSON.stringify(['EVENT', 'e2e-subscription', event]));
    await new Promise((resolve) => setTimeout(resolve, 250));

    await expect(
      dataSource.getRepository(Impact).count({
        where: { campaignId, targetEventId: event.id },
      }),
    ).resolves.toBe(1);
    expect(mockEvaluateIntent).toHaveBeenCalledTimes(1);
    expect(mockPublishComment).toHaveBeenCalledTimes(1);
    expect(mockSendZap).toHaveBeenCalledTimes(1);
  });

  afterAll(async () => {
    await app.close();
  });
});
