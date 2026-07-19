import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import WebSocket from 'ws';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { type Event, verifyEvent } from 'nostr-tools/pure';
import { getPlatformPublicKey } from './nostr-keys.util';

const MAX_RELAY_MESSAGE_BYTES = 16 * 1024;
const MAX_EVENT_AGE_SECONDS = 24 * 60 * 60;
const MAX_FUTURE_EVENT_SKEW_SECONDS = 5 * 60;
const JOB_DEDUP_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export interface CampaignKeywords {
  id: string;
  name: string;
  productDescription: string;
  keywords: string[];
}

export interface CampaignJobData {
  campaignId: string;
  campaignName: string;
  productDescription: string;
  foundKeywords: string[];
  eventId: string;
  pubkey: string;
  content: string;
  createdAt: number;
}

function isNostrEvent(value: unknown): value is Event {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.id) &&
    'pubkey' in value &&
    typeof value.pubkey === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.pubkey) &&
    'content' in value &&
    typeof value.content === 'string' &&
    'created_at' in value &&
    Number.isSafeInteger(value.created_at) &&
    'kind' in value &&
    Number.isSafeInteger(value.kind) &&
    'sig' in value &&
    typeof value.sig === 'string' &&
    /^[a-f0-9]{128}$/i.test(value.sig) &&
    'tags' in value &&
    Array.isArray(value.tags) &&
    value.tags.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.every((tagValue) => typeof tagValue === 'string'),
    )
  );
}

function hasAcceptableTimestamp(
  createdAt: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    createdAt >= now - MAX_EVENT_AGE_SECONDS &&
    createdAt <= now + MAX_FUTURE_EVENT_SKEW_SECONDS
  );
}

@Injectable()
export class NostrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NostrService.name);
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private platformPublicKey?: string;
  private readonly relayUrl =
    process.env.NOSTR_RELAY_URL ?? 'wss://relay.damus.io';

  constructor(
    private campaignsService: CampaignsService, // Inyectaremos el servicio de campañas para acceder a la DB
    @InjectQueue('nostr-matches') private nostrQueue: Queue<CampaignJobData>,
  ) {}

  // --- MEMORIA RAM ---
  // Guardamos las campañas activas y sus keywords aquí
  private activeCampaigns: CampaignKeywords[] = [];

  onModuleInit() {
    this.platformPublicKey = getPlatformPublicKey();
    void this.updateCampaignsCache();
    this.connectToRelay();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleKeywordsSinking() {
    console.log('Sincronizando keywords de campañas activas desde la DB...');
    await this.updateCampaignsCache();
  }

  private async updateCampaignsCache() {
    try {
      const activeCampaignsFromDB = await this.campaignsService.findActive();

      // Almacenamos en memoria RAM normalizando las keywords a minúsculas
      this.activeCampaigns = activeCampaignsFromDB.map((c) => ({
        id: c.id,
        name: c.name,
        productDescription: c.productDescription,
        keywords: c.keywords.map((kw) => kw.toLowerCase()),
      }));

      this.logger.log(
        `Caché actualizada. ${this.activeCampaigns.length} campañas activas en memoria RAM.`,
      );
    } catch {
      this.logger.error('Error al actualizar las keywords de la DB.');
    }
  }

  private connectToRelay() {
    if (this.isShuttingDown) return;

    const ws = new WebSocket(this.relayUrl, {
      maxPayload: MAX_RELAY_MESSAGE_BYTES,
    });
    this.ws = ws;

    ws.on('open', () => {
      if (this.isShuttingDown || this.ws !== ws) {
        ws.close();
        return;
      }

      this.logger.log(`Connected to Nostr relay: ${this.relayUrl}`);

      // Una vez conectados, podemos suscribirnos a eventos globales
      this.subscribeToEvents();
    });

    ws.on('message', (data: WebSocket.Data) => {
      void this.handleRelayMessage(data);
    });

    ws.on('error', () => {
      this.logger.warn('Error de conexión con el relay de Nostr.');
    });

    ws.on('close', () => {
      if (this.isShuttingDown || this.ws !== ws) return;

      this.logger.warn('Conexión con relay cerrada; se reintentará.');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connectToRelay();
      }, 5000);
    });
  }

  // Estructura oficial de Nostr para suscribirse (REQ)
  private subscribeToEvents() {
    const subscriptionId = 'mi-suscripcion-nestjs';

    // Queremos notas de texto (kind: 1), limitadas a las últimas 5
    const filtro = {
      kinds: [1],
      limit: 5,
    };

    // Formato estricto Nostr: ["REQ", <subscription_id>, <filters>]
    const subscriptionMessage = JSON.stringify(['REQ', subscriptionId, filtro]);

    this.ws?.send(subscriptionMessage);
    this.logger.debug('Suscripción enviada al relay.');
  }

  // Procesar lo que nos devuelve el Relay
  private async handleRelayMessage(data: WebSocket.Data) {
    try {
      const rawMessage =
        typeof data === 'string'
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data).toString()
            : data instanceof ArrayBuffer
              ? Buffer.from(data).toString()
              : data.toString();

      if (Buffer.byteLength(rawMessage, 'utf8') > MAX_RELAY_MESSAGE_BYTES) {
        this.logger.warn(
          'Mensaje de relay descartado por exceder el tamaño máximo.',
        );
        return;
      }

      const message: unknown = JSON.parse(rawMessage);
      if (!Array.isArray(message)) {
        return;
      }

      const messageItems: unknown[] = message;
      const messageType = messageItems[0]; // "EVENT", "OK", "EOSE", etc.
      const event = messageItems[2];

      if (messageType !== 'EVENT' || !isNostrEvent(event)) {
        return;
      }

      if (
        event.kind !== 1 ||
        event.content.length < 10 ||
        event.content.length > 1000 ||
        !hasAcceptableTimestamp(event.created_at) ||
        !verifyEvent(event)
      ) {
        this.logger.debug('Evento Nostr descartado por validación.');
        return;
      }

      if (event.pubkey === this.platformPublicKey) {
        this.logger.debug('Evento Nostr propio descartado.');
        return;
      }

      // Buscar coincidencias con las campañas en memoria RAM.
      await this.findCampaignMatches(event, event.content);
    } catch {
      this.logger.warn('Mensaje de relay descartado por formato inválido.');
    }
  }

  // 1. EL ALGORITMO DE MATCHING (Limpio y con responsabilidad única)
  private async findCampaignMatches(
    event: Event,
    content: string,
  ): Promise<void> {
    const lowerCaseContent = content.toLowerCase();
    const matchesToEnqueue: Promise<unknown>[] = [];

    for (const campaign of this.activeCampaigns) {
      const foundKeywords = campaign.keywords.filter((keyword) =>
        lowerCaseContent.includes(keyword),
      );

      if (foundKeywords.length > 0) {
        // En lugar de disparar y olvidar, acumulamos las promesas
        const jobPromise = this.enqueueMatch(
          campaign,
          event,
          content,
          foundKeywords,
        );
        matchesToEnqueue.push(jobPromise);
      }
    }

    // Procesamos todos los envíos a la cola en paralelo de forma segura
    if (matchesToEnqueue.length > 0) {
      try {
        await Promise.all(matchesToEnqueue);
        this.logger.log(
          `[Éxito] ${matchesToEnqueue.length} matches enviados a BullMQ.`,
        );
      } catch {
        this.logger.error('No se pudieron encolar algunos matches en Redis.');
      }
    }
  }

  // 2. NUEVA FUNCIÓN ESPECIALIZADA (Responsabilidad Única)
  private async enqueueMatch(
    campaign: CampaignKeywords,
    event: Event,
    content: string,
    foundKeywords: string[],
  ): Promise<void> {
    this.logger.debug(`Match encontrado para la campaña ${campaign.id}.`);

    const jobData: CampaignJobData = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      productDescription: campaign.productDescription,
      foundKeywords,
      eventId: event.id,
      pubkey: event.pubkey,
      content,
      createdAt: event.created_at,
    };

    // BullMQ requires custom IDs containing colons to have three segments.
    const jobId = `${campaign.id}:${event.id}:match`;
    await this.nostrQueue.add('procesar-match', jobData, {
      attempts: 3,
      backoff: 5000,
      jobId,
      removeOnComplete: { age: JOB_DEDUP_RETENTION_SECONDS },
      removeOnFail: { age: JOB_DEDUP_RETENTION_SECONDS },
    });
  }

  // Método para publicar tus propias notas desde cualquier parte de tu app
  public enviarEvento(signedEvent: unknown) {
    // Formato estricto Nostr para publicar: ["EVENT", <event_object>]
    const message = JSON.stringify(['EVENT', signedEvent]);
    if (this.ws?.readyState === WebSocket.OPEN && !this.isShuttingDown) {
      this.ws.send(message);
    } else {
      this.logger.warn('No se pudo enviar; el socket no está abierto.');
    }
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
  }
}
