import { Injectable, Logger } from '@nestjs/common';
import { NWCClient } from '@getalby/sdk';
import { CryptoService } from 'src/crypto/crypto.service';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { nip57 } from 'nostr-tools';
import { getPlatformSecretKey, getRelayUrl } from 'src/nostr/nostr-keys.util';

export type ZapResult =
  | { success: true; feesPaid: number }
  | { success: false; reason: 'no_lightning' | 'payment_failed'; message: string };

export interface SendZapInput {
  encryptedNwcUrl: string;
  targetPubkey: string;
  targetEventId: string;
  amountSats: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly cryptoService: CryptoService) {}

  async sendZap(input: SendZapInput): Promise<ZapResult> {
    const relayUrl = getRelayUrl();
    let nwcUrl: string | undefined;

    try {
      nwcUrl = this.cryptoService.decrypt(input.encryptedNwcUrl);
      const metadata = await this.fetchUserMetadata(input.targetPubkey, relayUrl);

      if (!metadata) {
        return {
          success: false,
          reason: 'no_lightning',
          message: 'No se encontró perfil del usuario en Nostr.',
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

      const amountMsats = input.amountSats * 1000;
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
        relays: [relayUrl],
      });

      const signedZapRequest = finalizeEvent(
        zapRequestTemplate,
        getPlatformSecretKey(),
      );

      const invoice = await this.requestZapInvoice(callback, signedZapRequest, amountMsats);
      const client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });

      try {
        const payment = await client.payInvoice({ invoice });
        return { success: true, feesPaid: payment.fees_paid ?? 0 };
      } finally {
        client.close();
      }
    } catch (error) {
      this.logger.warn('Fallo al procesar el Zap', error);
      return {
        success: false,
        reason: 'payment_failed',
        message: error instanceof Error ? error.message : 'Error desconocido al pagar',
      };
    } finally {
      nwcUrl = undefined;
    }
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
    const url = new URL(callback);
    url.searchParams.set('amount', amountMsats.toString());
    url.searchParams.set('nostr', JSON.stringify(signedZapRequest));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`LNURL callback respondió con status ${response.status}`);
    }

    const body = (await response.json()) as { pr?: string; status?: string; reason?: string };
    if (body.status === 'ERROR') {
      throw new Error(body.reason ?? 'LNURL callback devolvió error');
    }
    if (!body.pr) {
      throw new Error('LNURL callback no devolvió invoice');
    }

    return body.pr;
  }
}
