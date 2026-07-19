import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { decodeInvoice } from '@getalby/lightning-tools/bolt11';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { nip57 } from 'nostr-tools';
import { CryptoService } from 'src/crypto/crypto.service';
import { MSATS_PER_SAT } from 'src/common/fees.util';
import {
  isPrivateOrLocalIpAddress,
  resolvePublicAddress,
} from 'src/common/network-security.util';
import { isRecord } from 'src/common/type-guards.util';
import { createNwcClient } from './nwc-client.util';
import {
  getPlatformSecretKey,
  getRelayUrl,
  getZapRelayUrl,
} from 'src/nostr/nostr-keys.util';
import {
  NOSTR_KIND_METADATA,
  NOSTR_KIND_TEXT_NOTE,
  NOSTR_KIND_ZAP_RECEIPT,
} from 'src/nostr/nostr.constants';

const LNURL_CALLBACK_TIMEOUT_MS = 5_000;
const MAX_LNURL_RESPONSE_BYTES = 16 * 1024;
const ZAP_RECEIPT_LOOKUP_ATTEMPTS = 2;
const ZAP_RECEIPT_RETRY_DELAY_MS = 1_500;

export type ZapResult =
  | {
      success: true;
      // Sats, rounded up from the NIP-47 fee amount expressed in msats.
      feesPaid: number;
      preimage: string;
      // false cuando el pago se liquido pero no se pudo verificar un
      // zap receipt (NIP-57 kind 9735) valido en el relay: no bloquea el
      // pago (ya ocurrio), pero indica que el exito no quedo confirmado
      // publicamente y merece revision operativa.
      receiptVerified: boolean;
    }
  | {
      success: false;
      reason: 'no_lightning' | 'payment_failed';
      message: string;
    };

export interface InvoiceReadyInfo {
  bolt11: string;
  paymentHash: string;
}

export interface SendZapInput {
  encryptedNwcUrl: string;
  targetPubkey: string;
  targetEventId: string;
  amountSats: number;
  // Se invoca justo antes de pagar, para persistir el hash de pago y
  // poder reconciliar el resultado si el proceso cae tras el pago.
  onInvoiceReady?: (info: InvoiceReadyInfo) => Promise<void>;
}

export interface PaymentStatusResult {
  settled: boolean;
  feesPaid?: number;
  preimage?: string;
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

function isValidZapReceipt(
  receipt: Event,
  params: {
    targetEventId: string;
    targetPubkey: string;
    bolt11: string;
    zapRequestId: string;
  },
): boolean {
  if (receipt.kind !== NOSTR_KIND_ZAP_RECEIPT) return false;
  if (!verifyEvent(receipt)) return false;

  const eTag = receipt.tags.find((tag) => tag[0] === 'e');
  const pTag = receipt.tags.find((tag) => tag[0] === 'p');
  const bolt11Tag = receipt.tags.find((tag) => tag[0] === 'bolt11');
  const descriptionTag = receipt.tags.find((tag) => tag[0] === 'description');

  if (eTag?.[1] !== params.targetEventId) return false;
  if (pTag?.[1] !== params.targetPubkey) return false;
  if (bolt11Tag?.[1] !== params.bolt11) return false;
  if (!descriptionTag?.[1]) return false;

  try {
    const zapRequest = JSON.parse(descriptionTag[1]) as { id?: unknown };
    return zapRequest.id === params.zapRequestId;
  } catch {
    return false;
  }
}

function getLnurlResponse(url: URL, address: string): Promise<string> {
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

/**
 * Fetch minimo con las mismas defensas anti-SSRF que el callback LNURL
 * (solo HTTPS, sin credenciales, sin redes locales, DNS pinning tras
 * resolver). Se instala como implementacion de fetch de nip57 para que
 * `getZapEndpoint` -que deriva una URL del perfil Nostr del destinatario,
 * un dato controlado por el propio usuario objetivo- nunca conecte a una
 * red privada, en vez de reimplementar a mano el parseo de lud06/lud16.
 */
export async function secureNip57Fetch(
  input: string | URL,
): Promise<{ json(): Promise<unknown> }> {
  const url = validateLnurlCallbackUrl(input.toString());
  const address = await resolvePublicAddress(
    url.hostname.replace(/^\[|\]$/g, ''),
  );
  const responseText = await getLnurlResponse(url, address);

  return {
    json: () => Promise.resolve(JSON.parse(responseText) as unknown),
  };
}

nip57.useFetchImplementation(secureNip57Fetch);

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
          kind: NOSTR_KIND_TEXT_NOTE,
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

      if (input.onInvoiceReady) {
        const decoded = decodeInvoice(invoice);
        if (!decoded) {
          throw new Error('No se pudo decodificar la invoice del Zap.');
        }
        await input.onInvoiceReady({
          bolt11: invoice,
          paymentHash: decoded.paymentHash,
        });
      }

      const client = await createNwcClient(nwcUrl);
      let payment: Awaited<ReturnType<typeof client.payInvoice>>;

      try {
        payment = await client.payInvoice({ invoice, amount: amountMsats });
      } finally {
        client.close();
      }

      const receiptVerified = await this.verifyZapReceipt({
        relayUrl: zapRelayUrl,
        targetEventId: input.targetEventId,
        targetPubkey: input.targetPubkey,
        bolt11: invoice,
        zapRequestId: signedZapRequest.id,
      });

      if (!receiptVerified) {
        this.logger.warn(
          `Zap pagado para ${input.targetEventId} sin zap receipt NIP-57 verificable en ${zapRelayUrl}.`,
        );
      }

      return {
        success: true,
        feesPaid: msatsToSatsCeil(payment.fees_paid ?? 0),
        preimage: payment.preimage,
        receiptVerified,
      };
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

  /**
   * Consulta el estado real de un pago ya intentado, para reconciliar
   * impactos cuyo resultado quedo ambiguo (por ejemplo, tras un timeout
   * de payInvoice o una caida del proceso). Nunca vuelve a pagar.
   */
  async checkPaymentStatus(
    encryptedNwcUrl: string,
    paymentHash: string,
  ): Promise<PaymentStatusResult> {
    const nwcUrl = this.cryptoService.decrypt(encryptedNwcUrl);
    const client = await createNwcClient(nwcUrl);

    try {
      const transaction = await client.lookupInvoice({
        payment_hash: paymentHash,
      });

      if (transaction.state !== 'settled') {
        return { settled: false };
      }

      return {
        settled: true,
        feesPaid: msatsToSatsCeil(transaction.fees_paid ?? 0),
        preimage: transaction.preimage,
      };
    } catch (error) {
      this.logger.warn('No se pudo reconciliar el pago con la wallet', error);
      return { settled: false };
    } finally {
      client.close();
    }
  }

  /**
   * Verifica en el relay de zaps que exista un zap receipt NIP-57 (kind
   * 9735) real para este pago: firma valida, tags e/p correctos, bolt11
   * pagado y zap request coincidentes. El receipt lo publica el servidor
   * LNURL del receptor luego de liquidar el pago, asi que puede tardar en
   * aparecer; se reintenta una vez con una espera breve antes de
   * declarar que no se pudo verificar.
   */
  private async verifyZapReceipt(params: {
    relayUrl: string;
    targetEventId: string;
    targetPubkey: string;
    bolt11: string;
    zapRequestId: string;
  }): Promise<boolean> {
    for (let attempt = 1; attempt <= ZAP_RECEIPT_LOOKUP_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, ZAP_RECEIPT_RETRY_DELAY_MS),
        );
      }

      const pool = new SimplePool();
      try {
        const receipts = await pool.querySync([params.relayUrl], {
          kinds: [NOSTR_KIND_ZAP_RECEIPT],
          '#e': [params.targetEventId],
          '#p': [params.targetPubkey],
          limit: 10,
        });

        if (receipts.some((receipt) => isValidZapReceipt(receipt, params))) {
          return true;
        }
      } catch (error) {
        this.logger.warn('No se pudo consultar el zap receipt NIP-57', error);
      } finally {
        pool.close([params.relayUrl]);
      }
    }

    return false;
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
        kinds: [NOSTR_KIND_METADATA],
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

    const address = await resolvePublicAddress(
      url.hostname.replace(/^\[|\]$/g, ''),
    );
    const responseText = await getLnurlResponse(url, address);
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
}
