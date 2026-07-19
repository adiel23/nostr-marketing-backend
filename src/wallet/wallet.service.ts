import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { Injectable, Logger } from '@nestjs/common';
import { decodeInvoice } from '@getalby/lightning-tools/bolt11';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { nip57 } from 'nostr-tools';
import { CryptoService } from 'src/crypto/crypto.service';
import { createNwcClient } from './nwc-client.util';
import {
  getPlatformSecretKey,
  getRelayUrl,
  getZapRelayUrl,
} from 'src/nostr/nostr-keys.util';

const MSATS_PER_SAT = 1_000;
const LNURL_CALLBACK_TIMEOUT_MS = 5_000;
const MAX_LNURL_RESPONSE_BYTES = 16 * 1024;

export type ZapResult =
  | {
      success: true;
      // Sats, rounded up from the NIP-47 fee amount expressed in msats.
      feesPaid: number;
    }
  | {
      success: false;
      reason: 'no_lightning' | 'payment_failed';
      message: string;
    };

export interface SendZapInput {
  encryptedNwcUrl: string;
  targetPubkey: string;
  targetEventId: string;
  amountSats: number;
}

export function msatsToSatsCeil(msats: number): number {
  if (!Number.isFinite(msats) || msats < 0) {
    throw new Error('El fee de NWC debe ser un valor no negativo en msats.');
  }

  return Math.ceil(msats / MSATS_PER_SAT);
}

export function validateLnurlCallbackUrl(callback: string): URL {
  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    throw new Error('El callback LNURL no es una URL vÃ¡lida.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('El callback LNURL debe usar HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('El callback LNURL no puede incluir credenciales.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isPrivateOrLocalIpAddress(hostname)
  ) {
    throw new Error('El callback LNURL no puede apuntar a una red local.');
  }

  return url;
}

export function assertInvoiceAmount(
  invoice: string,
  amountMsats: number,
): void {
  if (!Number.isSafeInteger(amountMsats) || amountMsats <= 0) {
    throw new Error('El importe del Zap debe ser un entero positivo en msats.');
  }

  const decoded = decodeInvoice(invoice);
  if (!decoded || decoded.millisatoshi !== amountMsats) {
    throw new Error('La invoice LNURL no coincide con el importe solicitado.');
  }
}

function isPrivateOrLocalIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;

  if (family === 4) {
    const [first, second] = address.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly cryptoService: CryptoService) {}

  async sendZap(input: SendZapInput): Promise<ZapResult> {
    const relayUrl = getRelayUrl();
    const zapRelayUrl = getZapRelayUrl();
    let nwcUrl: string | undefined;

    try {
      const amountMsats = this.satsToMsats(input.amountSats);
      nwcUrl = this.cryptoService.decrypt(input.encryptedNwcUrl);
      const metadata = await this.fetchUserMetadata(
        input.targetPubkey,
        relayUrl,
      );

      if (!metadata) {
        return {
          success: false,
          reason: 'no_lightning',
          message: 'No se encontrÃ³ perfil del usuario en Nostr.',
        };
      }

      const callback = await nip57.getZapEndpoint(metadata);
      if (!callback) {
        return {
          success: false,
          reason: 'no_lightning',
          message: 'El usuario no tiene Lightning Address configurada.',
        };
      }

      const zapRequestTemplate = nip57.makeZapRequest({
        event: {
          id: input.targetEventId,
          pubkey: input.targetPubkey,
          kind: 1,
          tags: [],
          content: '',
          created_at: 0,
          sig: '',
        },
        amount: amountMsats,
        relays: [zapRelayUrl],
      });

      const signedZapRequest = finalizeEvent(
        zapRequestTemplate,
        getPlatformSecretKey(),
      );

      const invoice = await this.requestZapInvoice(
        callback,
        signedZapRequest,
        amountMsats,
      );
      assertInvoiceAmount(invoice, amountMsats);

      const client = createNwcClient(nwcUrl);

      try {
        const payment = await client.payInvoice({
          invoice,
          amount: amountMsats,
        });
        return {
          success: true,
          feesPaid: msatsToSatsCeil(payment.fees_paid ?? 0),
        };
      } finally {
        client.close();
      }
    } catch (error) {
      this.logger.warn('Fallo al procesar el Zap', error);
      return {
        success: false,
        reason: 'payment_failed',
        message:
          error instanceof Error ? error.message : 'Error desconocido al pagar',
      };
    } finally {
      nwcUrl = undefined;
    }
  }

  private satsToMsats(sats: number): number {
    const msats = sats * MSATS_PER_SAT;
    if (!Number.isSafeInteger(msats) || msats <= 0) {
      throw new Error(
        'El importe del Zap debe ser un entero positivo en sats.',
      );
    }

    return msats;
  }

  private async fetchUserMetadata(
    pubkey: string,
    relayUrl: string,
  ): Promise<Event | null> {
    const pool = new SimplePool();
    try {
      const events = await pool.querySync([relayUrl], {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      });
      return events[0] ?? null;
    } finally {
      pool.close([relayUrl]);
    }
  }

  private async requestZapInvoice(
    callback: string,
    signedZapRequest: Event,
    amountMsats: number,
  ): Promise<string> {
    const url = validateLnurlCallbackUrl(callback);
    url.searchParams.set('amount', amountMsats.toString());
    url.searchParams.set('nostr', JSON.stringify(signedZapRequest));

    const address = await this.resolvePublicAddress(
      url.hostname.replace(/^\[|\]$/g, ''),
    );
    const responseText = await this.getLnurlResponse(url, address);
    let body: unknown;

    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error('El callback LNURL no devolviÃ³ JSON vÃ¡lido.');
    }

    if (!isRecord(body)) {
      throw new Error('El callback LNURL devolviÃ³ una respuesta invÃ¡lida.');
    }

    if (body.status === 'ERROR') {
      throw new Error(
        typeof body.reason === 'string'
          ? body.reason
          : 'El callback LNURL devolviÃ³ error.',
      );
    }

    if (typeof body.pr !== 'string' || body.pr.length === 0) {
      throw new Error('El callback LNURL no devolviÃ³ invoice.');
    }

    return body.pr;
  }

  private async resolvePublicAddress(hostname: string): Promise<string> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const publicAddress = addresses.find(
      ({ address }) => !isPrivateOrLocalIpAddress(address),
    );

    if (!publicAddress) {
      throw new Error('El callback LNURL resuelve a una red privada o local.');
    }

    return publicAddress.address;
  }

  private getLnurlResponse(url: URL, address: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const request = https.request(
        {
          protocol: 'https:',
          hostname: address,
          servername: url.hostname.replace(/^\[|\]$/g, ''),
          port: url.port ? Number(url.port) : 443,
          method: 'GET',
          path: `${url.pathname}${url.search}`,
          headers: {
            accept: 'application/json',
            host: url.host,
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode >= 300 && statusCode < 400) {
            response.resume();
            rejectOnce(new Error('El callback LNURL no puede redirigir.'));
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            rejectOnce(
              new Error(`LNURL callback respondiÃ³ con status ${statusCode}`),
            );
            return;
          }

          const contentLengthHeader = response.headers['content-length'];
          const contentLength = Number(
            Array.isArray(contentLengthHeader)
              ? contentLengthHeader[0]
              : contentLengthHeader,
          );
          if (
            contentLengthHeader !== undefined &&
            (!Number.isSafeInteger(contentLength) ||
              contentLength < 0 ||
              contentLength > MAX_LNURL_RESPONSE_BYTES)
          ) {
            response.resume();
            rejectOnce(
              new Error('La respuesta LNURL excede el lÃ­mite permitido.'),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > MAX_LNURL_RESPONSE_BYTES) {
              request.destroy(
                new Error('La respuesta LNURL excede el lÃ­mite permitido.'),
              );
              return;
            }
            chunks.push(buffer);
          });
          response.on('error', rejectOnce);
          response.on('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        },
      );

      request.setTimeout(LNURL_CALLBACK_TIMEOUT_MS, () => {
        request.destroy(
          new Error('El callback LNURL excediÃ³ el tiempo lÃ­mite.'),
        );
      });
      request.on('error', rejectOnce);
      request.end();
    });
  }
}
