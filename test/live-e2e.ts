import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { NWCClient } from '@getalby/sdk';
import { NestFactory } from '@nestjs/core';
import { Job, Queue } from 'bullmq';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { decode } from 'nostr-tools/nip19';
import {
  generateSecretKey,
  finalizeEvent,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { DataSource } from 'typeorm';
import WebSocket, { type RawData, WebSocketServer } from 'ws';
import { NOSTR_KIND_ZAP_RECEIPT } from 'src/nostr/nostr.constants';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface RelayFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  limit?: number;
}

interface ImpactRow {
  status: string;
  sats_charged: number;
  platform_fee: number;
  bolt11: string | null;
  payment_hash: string | null;
  preimage: string | null;
}

const RELAY_PORT = 48195;
const WAIT_TIMEOUT_MS = 90_000;
const DEFAULT_ZAP_RELAY_URL = 'wss://relay.getalby.com';
const DEMO_WALLET_READY_RETRIES = 4;
const loadRuntimeModule = createRequire(__filename);

interface NostrServiceLike {
  handleKeywordsSinking(): Promise<void>;
}

interface MatchResult {
  status?: string;
  evaluation?: {
    match?: boolean;
    confidence?: number;
    reason?: string;
  };
  impact?: {
    commentEventId?: string;
  };
}

interface DemoWallet {
  nwcUrl: string;
  lud16: string;
}

function logStage(stage: string, detail: string): void {
  console.log(`[live-e2e] ${stage}: ${detail}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} debe estar configurada para la prueba live E2E.`);
  }
  return value;
}

function assertTestDatabase(): void {
  const dbName = process.env.DB_NAME ?? '';
  const looksLikeTestDb = /(^|[_-])(test|live[_-]?e2e)([_-]|$)/i.test(dbName);
  const explicitlyAllowed =
    !!dbName && process.env.LIVE_E2E_ALLOW_DB === dbName;

  if (!looksLikeTestDb && !explicitlyAllowed) {
    throw new Error(
      `DB_NAME="${dbName}" no parece una base de datos de pruebas. ` +
        'Live E2E crea y borra datos reales: use un nombre que contenga ' +
        '"test" o "live_e2e", o confirme explicitamente con ' +
        `LIVE_E2E_ALLOW_DB=${dbName || '<nombre-exacto>'}.`,
    );
  }
}

function getTestPosterSecretKey(): Uint8Array {
  const secret = requiredEnvironment('TEST_POSTER_NSEC');

  if (secret.startsWith('nsec1')) {
    const decoded = decode(secret);
    if (decoded.type !== 'nsec') {
      throw new Error('TEST_POSTER_NSEC no es un nsec valido.');
    }
    return decoded.data;
  }

  if (/^[a-f0-9]{64}$/i.test(secret)) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }

  throw new Error('TEST_POSTER_NSEC debe ser un nsec o hex de 64 caracteres.');
}

async function createDemoWallet(retries = 3): Promise<DemoWallet> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch('https://faucet.nwc.dev?balance=10000', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const nwcUrl = (await response.text()).trim();
      const connection = new URL(nwcUrl);
      const lud16 = connection.searchParams.get('lud16');
      if (
        connection.protocol !== 'nostr+walletconnect:' ||
        !connection.hostname ||
        !connection.searchParams.get('relay') ||
        !connection.searchParams.get('secret') ||
        !lud16
      ) {
        throw new Error('respuesta de conexion incompleta');
      }

      return { nwcUrl, lud16 };
    } catch (error) {
      if (attempt === retries) {
        const detail =
          error instanceof Error ? error.message : 'error desconocido';
        throw new Error(
          `No se pudo crear una wallet demo del faucet (${detail}).`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error('No se pudo crear una wallet demo del faucet.');
}

async function waitForDemoWallet(wallet: DemoWallet): Promise<void> {
  for (let attempt = 1; attempt <= DEMO_WALLET_READY_RETRIES; attempt += 1) {
    const client = new NWCClient({ nostrWalletConnectUrl: wallet.nwcUrl });
    try {
      const balance = await client.getBalance();
      if (balance.balance >= 10_000_000) return;
      throw new Error('saldo demo inicial inesperado');
    } catch (error) {
      if (attempt === DEMO_WALLET_READY_RETRIES) {
        const detail =
          error instanceof Error ? error.message : 'error desconocido';
        throw new Error(
          `La wallet demo no quedo disponible a tiempo (${detail}).`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    } finally {
      client.close();
    }
  }
}

async function publishToPublicRelay(
  relayUrl: string,
  event: NostrEvent,
): Promise<void> {
  const pool = new SimplePool();
  try {
    await Promise.all(pool.publish([relayUrl], event));
  } finally {
    pool.close([relayUrl]);
  }
}

function getLud16FromProfile(profile: NostrEvent): string | undefined {
  try {
    const metadata: unknown = JSON.parse(profile.content);
    if (typeof metadata !== 'object' || metadata === null) return undefined;
    const lud16 = (metadata as Record<string, unknown>).lud16;
    return typeof lud16 === 'string' ? lud16.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchPublicProfile(
  relayUrl: string,
  pubkey: string,
): Promise<NostrEvent | null> {
  const pool = new SimplePool();
  try {
    const profiles = await pool.querySync(
      [relayUrl],
      { kinds: [0], authors: [pubkey], limit: 10 },
      { maxWait: 10_000 },
    );
    const profile = profiles.sort((a, b) => b.created_at - a.created_at)[0];
    return profile ?? null;
  } finally {
    pool.close([relayUrl]);
  }
}

async function waitForPublicComment(
  relayUrl: string,
  commentEventId: string,
  targetEventId: string,
  platformPubkey: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const pool = new SimplePool();
    try {
      const event = await pool.get(
        [relayUrl],
        { ids: [commentEventId], limit: 1 },
        { maxWait: 5_000 },
      );
      if (
        event?.kind === 1 &&
        event.pubkey === platformPubkey &&
        event.tags.some((tag) => tag[0] === 'e' && tag[1] === targetEventId)
      ) {
        return;
      }
    } finally {
      pool.close([relayUrl]);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('El comentario no aparecio en el relay publico.');
}

/**
 * Confirmacion independiente del recibo NIP-57 publicado por el receptor.
 * La aplicacion ya valida el recibo internamente; este chequeo de caja negra
 * prueba que el artefacto publico concuerda con la invoice persistida.
 */
async function waitForPublicZapReceipt(
  relayUrl: string,
  targetEventId: string,
  targetPubkey: string,
  bolt11: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const pool = new SimplePool();
    try {
      const receipts = await pool.querySync(
        [relayUrl],
        {
          kinds: [NOSTR_KIND_ZAP_RECEIPT],
          '#e': [targetEventId],
          '#p': [targetPubkey],
          limit: 20,
        },
        { maxWait: 5_000 },
      );
      const receipt = receipts.find(
        (event) =>
          verifyEvent(event) &&
          event.tags.some(
            (tag) => tag[0] === 'e' && tag[1] === targetEventId,
          ) &&
          event.tags.some((tag) => tag[0] === 'p' && tag[1] === targetPubkey) &&
          event.tags.some((tag) => tag[0] === 'bolt11' && tag[1] === bolt11),
      );
      if (receipt) return;
    } finally {
      pool.close([relayUrl]);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    'El recibo NIP-57 no aparecio o no valido en el relay publico.',
  );
}

function matchesFilter(event: NostrEvent, filter: RelayFilter): boolean {
  return (
    (!filter.ids || filter.ids.includes(event.id)) &&
    (!filter.authors || filter.authors.includes(event.pubkey)) &&
    (!filter.kinds || filter.kinds.includes(event.kind))
  );
}

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function parseRelayMessage(data: RawData): unknown[] | null {
  try {
    const value: unknown = JSON.parse(rawDataToText(data));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

class ControlledRelay {
  private readonly events = new Map<string, NostrEvent>();
  private readonly subscriptions = new Map<
    WebSocket,
    Map<string, RelayFilter>
  >();
  private readonly subscriptionWaiters: Array<() => void> = [];
  private readonly server = new WebSocketServer({ port: RELAY_PORT });

  constructor() {
    this.server.on('connection', (socket) => {
      this.subscriptions.set(socket, new Map());
      socket.on('message', (data) => this.handleMessage(socket, data));
      socket.on('close', () => this.subscriptions.delete(socket));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });
  }

  async waitForSubscription(timeoutMs = 10_000): Promise<void> {
    if (this.hasSubscription()) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.subscriptionWaiters.indexOf(onSubscribed);
        if (index >= 0) this.subscriptionWaiters.splice(index, 1);
        reject(new Error('La aplicacion no se suscribio al relay local.'));
      }, timeoutMs);
      const onSubscribed = () => {
        clearTimeout(timer);
        resolve();
      };
      this.subscriptionWaiters.push(onSubscribed);
    });
  }

  hasPlatformComment(targetEventId: string, platformPubkey: string): boolean {
    return [...this.events.values()].some(
      (event) =>
        event.kind === 1 &&
        event.pubkey === platformPubkey &&
        event.tags.some((tag) => tag[0] === 'e' && tag[1] === targetEventId),
    );
  }

  async publish(event: NostrEvent): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`);
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new Error('El relay local no confirmo la publicacion de prueba.'),
        );
      }, 10_000);

      socket.on('open', () => socket.send(JSON.stringify(['EVENT', event])));
      socket.on('message', (data) => {
        const message = parseRelayMessage(data);
        if (
          message?.[0] === 'OK' &&
          message[1] === event.id &&
          message[2] === true
        ) {
          clearTimeout(timer);
          socket.close();
          resolve();
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.close();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private hasSubscription(): boolean {
    return [...this.subscriptions.values()].some(
      (subscriptions) => subscriptions.size > 0,
    );
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    const message = parseRelayMessage(data);
    if (!message) return;

    if (message[0] === 'REQ' && typeof message[1] === 'string') {
      const subscriptionId = message[1];
      const filter = message[2];
      if (
        typeof filter !== 'object' ||
        filter === null ||
        Array.isArray(filter)
      ) {
        socket.send(
          JSON.stringify(['CLOSED', subscriptionId, 'invalid filter']),
        );
        return;
      }

      const typedFilter = filter as RelayFilter;
      this.subscriptions.get(socket)?.set(subscriptionId, typedFilter);
      for (const event of this.matchingEvents(typedFilter)) {
        socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
      }
      socket.send(JSON.stringify(['EOSE', subscriptionId]));
      for (const waiter of this.subscriptionWaiters.splice(0)) waiter();
      return;
    }

    if (message[0] === 'EVENT' && this.isNostrEvent(message[1])) {
      const event = message[1];
      this.events.set(event.id, event);
      socket.send(JSON.stringify(['OK', event.id, true, 'accepted']));
      this.broadcast(event);
    }
  }

  private matchingEvents(filter: RelayFilter): NostrEvent[] {
    const matches = [...this.events.values()]
      .filter((event) => matchesFilter(event, filter))
      .sort((left, right) => left.created_at - right.created_at);
    return filter.limit ? matches.slice(-filter.limit) : matches;
  }

  private broadcast(event: NostrEvent): void {
    for (const [socket, subscriptions] of this.subscriptions) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      for (const [subscriptionId, filter] of subscriptions) {
        if (matchesFilter(event, filter)) {
          socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
        }
      }
    }
  }

  private isNostrEvent(value: unknown): value is NostrEvent {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      'pubkey' in value &&
      typeof value.pubkey === 'string' &&
      'created_at' in value &&
      typeof value.created_at === 'number' &&
      'kind' in value &&
      typeof value.kind === 'number' &&
      'tags' in value &&
      Array.isArray(value.tags) &&
      'content' in value &&
      typeof value.content === 'string' &&
      'sig' in value &&
      typeof value.sig === 'string'
    );
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  method: 'POST',
  body: unknown,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`La API live E2E devolvio HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function requestJsonWithRetries<T>(
  baseUrl: string,
  path: string,
  method: 'POST',
  body: unknown,
  accessToken: string | undefined,
  retries: number,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await requestJson<T>(baseUrl, path, method, body, accessToken);
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }

  throw new Error('No se pudo completar la solicitud de API.');
}

function getString(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`La respuesta de API no contiene ${field}.`);
  }
  const fieldValue = (value as Record<string, unknown>)[field];
  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    throw new Error(`La respuesta de API no contiene ${field}.`);
  }
  return fieldValue;
}

async function waitForImpact(
  dataSource: DataSource,
  campaignId: string,
  eventId: string,
): Promise<ImpactRow | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await dataSource.query<ImpactRow[]>(
      `SELECT status, sats_charged, platform_fee, bolt11, payment_hash, preimage
       FROM impacts
       WHERE campaign_id = $1 AND target_event_id = $2`,
      [campaignId, eventId],
    );
    if (rows[0] && rows[0].status !== 'pending') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function waitForJob(queue: Queue, jobId: string): Promise<Job | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId);
    if (job && (await job.getState()) === 'completed') return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main(): Promise<void> {
  dotenv.config({ path: process.env.LIVE_E2E_ENV_FILE ?? '.env' });
  assertTestDatabase();

  const useFreshDemoWallets =
    process.env.LIVE_E2E_CREATE_DEMO_WALLETS === 'true';
  const requiredConfirmation = useFreshDemoWallets
    ? 'SEND_ONE_DEMO_ZAP'
    : 'SEND_ONE_REAL_ZAP';
  if (process.env.LIVE_E2E_CONFIRM !== requiredConfirmation) {
    throw new Error(
      `Defina LIVE_E2E_CONFIRM=${requiredConfirmation} para ejecutar.`,
    );
  }

  const maxSats = Number(requiredEnvironment('TEST_MAX_SATS'));
  const maxFeeSats = Number(requiredEnvironment('TEST_MAX_FEE_SATS'));
  if (!Number.isSafeInteger(maxSats) || maxSats < 1) {
    throw new Error('TEST_MAX_SATS debe ser un entero positivo.');
  }
  if (!Number.isSafeInteger(maxFeeSats) || maxFeeSats < 0) {
    throw new Error('TEST_MAX_FEE_SATS debe ser un entero no negativo.');
  }

  let nwcUrl: string;
  let recipientLud16: string;
  if (useFreshDemoWallets) {
    const [payerWallet, recipientWallet] = await Promise.all([
      createDemoWallet(),
      createDemoWallet(),
    ]);
    await Promise.all([
      waitForDemoWallet(payerWallet),
      waitForDemoWallet(recipientWallet),
    ]);
    nwcUrl = payerWallet.nwcUrl;
    recipientLud16 = recipientWallet.lud16;
    logStage(
      'demo-wallets',
      'created and verified two fresh faucet wallets (credentials redacted)',
    );
  } else {
    nwcUrl = requiredEnvironment('TEST_NWC_URL');
    recipientLud16 = requiredEnvironment('TEST_RECIPIENT_LUD16');
  }

  const publicRelayUrl =
    process.env.LIVE_E2E_PUBLIC_RELAY_URL ??
    process.env.LIVE_E2E_ZAP_RELAY_URL ??
    process.env.NOSTR_PUBLISH_RELAY_URL ??
    process.env.NOSTR_RELAY_URL ??
    DEFAULT_ZAP_RELAY_URL;
  process.env.NOSTR_RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}`;
  process.env.NOSTR_ZAP_RELAY_URL = publicRelayUrl;
  process.env.NOSTR_PUBLISH_RELAY_URL = publicRelayUrl;
  process.env.BULL_BOARD_ENABLED = 'false';

  const relay = new ControlledRelay();
  let app: INestApplication | undefined;
  let dataSource: DataSource | undefined;
  let companyId: string | undefined;
  let campaignId: string | undefined;

  try {
    await relay.start();
    logStage('relay', `local relay ready on port ${RELAY_PORT}`);
    const { AppModule } = loadRuntimeModule('src/app.module') as {
      AppModule: Type<unknown>;
    };
    const { NostrService } = loadRuntimeModule('src/nostr/nostr.service') as {
      NostrService: Type<NostrServiceLike>;
    };
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    logStage('api', `started on ${await app.getUrl()}`);

    dataSource = app.get(DataSource);
    const db = dataSource;
    if (!db) throw new Error('No se pudo obtener el DataSource de la app.');
    const nostrService = app.get<NostrServiceLike>(NostrService);
    const nostrQueue = app.get<Queue>(getQueueToken('nostr-matches'));
    await relay.waitForSubscription();
    logStage('nostr', 'listener subscribed to controlled relay');

    const testId = Date.now().toString(36);
    const email = `live-e2e-${testId}@example.test`;
    const company = await requestJson<unknown>(
      await app.getUrl(),
      '/companies',
      'POST',
      {
        name: 'Empresa Live E2E',
        email,
        password: 'live-e2e-password',
      },
    );
    companyId = getString(company, 'id');
    logStage('company', `created id=${companyId}`);
    const login = await requestJson<unknown>(
      await app.getUrl(),
      '/auth/login',
      'POST',
      { email, password: 'live-e2e-password' },
    );
    const accessToken = getString(login, 'access_token');
    const keyword = `live-zap-${testId}`;
    const campaign = await requestJsonWithRetries<unknown>(
      await app.getUrl(),
      '/campaigns',
      'POST',
      {
        name: 'Prueba real Lightning',
        productDescription:
          'Una wallet Lightning para pagos inmediatos y seguros.',
        keywords: [keyword],
        nwcUrl,
        satsPerImpact: maxSats,
        budgetSats: Math.ceil(maxSats * 1.1),
        endsAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
      accessToken,
      useFreshDemoWallets ? 3 : 1,
    );
    campaignId = getString(campaign, 'id');
    logStage(
      'campaign',
      `created id=${campaignId} keyword=${keyword} sats_per_impact=${maxSats}`,
    );
    await nostrService.handleKeywordsSinking();
    logStage('campaign-cache', 'refreshed with the newly created campaign');

    const recipientSecret = useFreshDemoWallets
      ? generateSecretKey()
      : getTestPosterSecretKey();
    const recipientPubkey = getPublicKey(recipientSecret);
    const platformKeys = loadRuntimeModule('src/nostr/nostr-keys.util') as {
      getPlatformPublicKey(): string;
    };
    if (recipientPubkey === platformKeys.getPlatformPublicKey()) {
      throw new Error(
        'TEST_POSTER_NSEC debe ser distinto de la identidad de plataforma.',
      );
    }
    const now = Math.floor(Date.now() / 1000);
    if (useFreshDemoWallets) {
      const profile = finalizeEvent(
        {
          kind: 0,
          created_at: now,
          tags: [],
          content: JSON.stringify({
            name: 'Receptor Live E2E',
            lud16: recipientLud16,
          }),
        },
        recipientSecret,
      );
      await Promise.all([
        relay.publish(profile),
        publishToPublicRelay(publicRelayUrl, profile),
      ]);
      logStage(
        'recipient-profile',
        'published temporary kind=0 with a zap-compatible lud16',
      );
    } else {
      const existingProfile = await fetchPublicProfile(
        publicRelayUrl,
        recipientPubkey,
      );
      if (existingProfile) {
        const profileLud16 = getLud16FromProfile(existingProfile);
        if (profileLud16?.toLowerCase() !== recipientLud16.toLowerCase()) {
          throw new Error(
            'El perfil publico de TEST_POSTER_NSEC no coincide con TEST_RECIPIENT_LUD16.',
          );
        }
        await relay.publish(existingProfile);
        logStage(
          'recipient-profile',
          'verified existing public profile and mirrored it only to the local relay',
        );
      } else {
        const profile = finalizeEvent(
          {
            kind: 0,
            created_at: now,
            tags: [],
            content: JSON.stringify({
              name: 'Receptor Live E2E',
              lud16: recipientLud16,
            }),
          },
          recipientSecret,
        );
        await Promise.all([
          relay.publish(profile),
          publishToPublicRelay(publicRelayUrl, profile),
        ]);
        logStage(
          'recipient-profile',
          'published the first public kind=0 profile for TEST_POSTER_NSEC',
        );
      }
    }

    const note = finalizeEvent(
      {
        kind: 1,
        created_at: now + 1,
        tags: [],
        content: `Quiero comprar ${keyword}; necesito una wallet Lightning ahora.`,
      },
      recipientSecret,
    );
    await Promise.all([
      relay.publish(note),
      publishToPublicRelay(publicRelayUrl, note),
    ]);
    logStage('nostr-event', `published kind=1 id=${note.id}`);

    const impact = await waitForImpact(db, campaignId, note.id);
    const jobId = `${campaignId}:${note.id}:match`;
    const job = await waitForJob(nostrQueue, jobId);
    const jobState = job ? await job.getState() : 'missing';
    const jobResult = job?.returnvalue as MatchResult | undefined;
    logStage('match-job', `id=${jobId} state=${jobState}`);
    if (jobResult?.evaluation) {
      logStage(
        'llm',
        `match=${jobResult.evaluation.match === true} confidence=${jobResult.evaluation.confidence ?? 'unknown'} reason=${jobResult.evaluation.reason ?? 'not-provided'}`,
      );
    }
    if (!impact || impact.status !== 'full_success') {
      throw new Error(`El match no llego a full_success (job: ${jobState}).`);
    }

    const walletFeeSats =
      Number(impact.sats_charged) - maxSats - Number(impact.platform_fee);
    if (walletFeeSats < 0 || walletFeeSats > maxFeeSats) {
      throw new Error('La comision de wallet excedio el limite autorizado.');
    }

    if (!impact.bolt11 || !impact.payment_hash || !impact.preimage) {
      throw new Error(
        'El impacto completo no conservo la invoice, hash y preimage del pago.',
      );
    }

    const commentEventId = jobResult?.impact?.commentEventId;
    if (!commentEventId) {
      throw new Error('El worker no devolvio el identificador del comentario.');
    }
    await waitForPublicComment(
      publicRelayUrl,
      commentEventId,
      note.id,
      requiredEnvironment('PLATFORM_NPUB'),
    );
    await waitForPublicZapReceipt(
      publicRelayUrl,
      note.id,
      recipientPubkey,
      impact.bolt11,
    );

    const rows = await db.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count
       FROM impacts
       WHERE campaign_id = $1 AND target_event_id = $2`,
      [campaignId, note.id],
    );
    if (rows[0]?.count !== '1') {
      throw new Error('La prueba produjo mas de un impacto para el evento.');
    }

    logStage(
      'impact',
      `status=full_success sats_charged=${impact.sats_charged} platform_fee=${impact.platform_fee} wallet_fee=${walletFeeSats}`,
    );
    console.log('LIVE_E2E_RESULT=full_success');
    console.log(`LIVE_E2E_PAYMENT_SATS=${maxSats}`);
    console.log(`LIVE_E2E_WALLET_FEE_SATS=${walletFeeSats}`);
    console.log('LIVE_E2E_COMMENT_PUBLISHED=true');
    console.log('LIVE_E2E_RECEIPT_VERIFIED=true');
  } finally {
    if (dataSource && (campaignId || companyId)) {
      try {
        if (campaignId) {
          await dataSource.query('DELETE FROM impacts WHERE campaign_id = $1', [
            campaignId,
          ]);
          await dataSource.query('DELETE FROM campaigns WHERE id = $1', [
            campaignId,
          ]);
        }
        if (companyId) {
          await dataSource.query('DELETE FROM companies WHERE id = $1', [
            companyId,
          ]);
        }
        logStage(
          'cleanup',
          `removed company=${companyId ?? 'n/a'} campaign=${campaignId ?? 'n/a'}`,
        );
      } catch (error) {
        console.error(
          'No se pudieron limpiar los datos de la prueba live E2E:',
          error,
        );
      }
    }
    await app?.close();
    await relay.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `LIVE_E2E_RESULT=failed:${error.message}`
      : 'LIVE_E2E_RESULT=failed',
  );
  process.exitCode = 1;
});
