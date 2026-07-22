import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NWCClient } from '@getalby/sdk';
import { CryptoService } from 'src/crypto/crypto.service';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { nip57 } from 'nostr-tools';
import { getPlatformSecretKey, getRelayUrl } from 'src/nostr/nostr-keys.util';
import { NostrService } from 'src/nostr/nostr.service';
import { msatsToSafeNumber } from 'src/common/fees.util';

export type PreparedZapResult =
  | { success: true; invoice: string }
  | {
      success: false;
      reason: 'no_lightning' | 'invoice_failed';
      message: string;
    };

export type InvoicePaymentResult =
  | { success: true; feesPaidMsats: string; preimage: string }
  | { success: false; reason: 'payment_failed'; message: string };

export interface PrepareZapInput {
  targetPubkey: string;
  targetEventId: string;
  amountMsats: string;
}

@Injectable()
export class WalletService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletService.name);
  private readonly advertiserClients = new Map<string, NWCClient>();
  private readonly operationQueues = new Map<string, Promise<void>>();
  private platformClient?: NWCClient;
  private platformCapabilitiesValidated = false;

  constructor(
    private readonly cryptoService: CryptoService,
    private readonly nostrService: NostrService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const client = this.createPlatformClient();
      await this.assertMethods(client, ['make_invoice', 'lookup_invoice']);
      this.platformCapabilitiesValidated = true;
      this.logger.log('Wallet NWC de plataforma validada correctamente.');
    } catch (error) {
      this.logger.error(
        `No se pudo validar PLATFORM_NWC_URL al iniciar: ${this.errorMessage(error)}. ` +
          'El API continuará activo, pero no publicará nuevos impactos hasta que la wallet responda.',
      );
    }
  }

  onModuleDestroy(): void {
    this.platformClient?.close();
    for (const client of this.advertiserClients.values()) client.close();
    this.advertiserClients.clear();
    this.operationQueues.clear();
  }

  async validateAdvertiserNwc(
    nwcUrl: string,
    minimumRequiredMsats: bigint,
  ): Promise<void> {
    const client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
    try {
      await this.assertMethods(client, [
        'get_balance',
        'pay_invoice',
        'lookup_invoice',
      ]);
      const { balance } = await this.retryNwcPublish('get_balance', () =>
        client.getBalance(),
      );
      if (BigInt(balance) < minimumRequiredMsats) {
        throw new Error(
          `INSUFFICIENT_BALANCE:${minimumRequiredMsats.toString()}`,
        );
      }
    } finally {
      client.close();
    }
  }

  async getAdvertiserBalanceMsats(encryptedNwcUrl: string): Promise<bigint> {
    return this.withAdvertiserClient(encryptedNwcUrl, async (client) => {
      const { balance } = await this.retryNwcPublish('get_balance', () =>
        client.getBalance(),
      );
      return BigInt(balance);
    });
  }

  async createPlatformFeeInvoice(
    amountMsats: string,
    impactId: string,
  ): Promise<{ invoice: string; paymentHash: string }> {
    return this.withPlatformClient(async (client) => {
      if (!this.platformCapabilitiesValidated) {
        await this.assertMethods(client, ['make_invoice', 'lookup_invoice']);
        this.platformCapabilitiesValidated = true;
      }
      const result = await this.retryNwcPublish('make_invoice', () =>
        client.makeInvoice({
          amount: msatsToSafeNumber(amountMsats),
          description: `Nostr Marketing platform fee ${impactId}`,
          expiry: 86_400,
          metadata: { impactId, type: 'platform_fee' },
        }),
      );
      if (!result.invoice || !result.payment_hash) {
        throw new Error(
          'La wallet de plataforma no devolvió una invoice válida.',
        );
      }
      return { invoice: result.invoice, paymentHash: result.payment_hash };
    });
  }

  async isPlatformInvoicePaid(paymentHash: string): Promise<boolean> {
    return (await this.getPlatformInvoiceState(paymentHash)) === 'settled';
  }

  async getPlatformInvoiceState(paymentHash: string): Promise<string | null> {
    return this.withPlatformClient(async (client) => {
      try {
        const result = await this.retryNwcPublish('lookup_invoice', () =>
          client.lookupInvoice({ payment_hash: paymentHash }),
        );
        if (result.state === 'settled' || result.settled_at) return 'settled';
        if (
          result.state === 'failed' ||
          (result.expires_at > 0 && Date.now() / 1000 > result.expires_at)
        ) {
          return 'expired';
        }
        return result.state ?? 'pending';
      } catch {
        return null;
      }
    });
  }

  async prepareZap(input: PrepareZapInput): Promise<PreparedZapResult> {
    const relays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
    ];

    try {
      const metadata = await this.fetchUserMetadata(input.targetPubkey, relays);
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

      const amountMsats = msatsToSafeNumber(input.amountMsats);
      const zapRequest = finalizeEvent(
        nip57.makeZapRequest({
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
          relays: [getRelayUrl()],
        }),
        getPlatformSecretKey(),
      );
      const invoice = await this.requestZapInvoice(
        callback,
        zapRequest,
        amountMsats,
      );
      return { success: true, invoice };
    } catch (error) {
      return {
        success: false,
        reason: 'invoice_failed',
        message: this.errorMessage(error),
      };
    }
  }

  async payAdvertiserInvoice(
    encryptedNwcUrl: string,
    invoice: string,
  ): Promise<InvoicePaymentResult> {
    return this.withAdvertiserClient(encryptedNwcUrl, async (client) => {
      try {
        const payment = await client.payInvoice({ invoice });
        return {
          success: true,
          feesPaidMsats: String(payment.fees_paid ?? 0),
          preimage: payment.preimage,
        };
      } catch (error) {
        const recovered = await this.lookupOutgoing(client, invoice);
        if (recovered?.state === 'settled') {
          return {
            success: true,
            feesPaidMsats: String(recovered.fees_paid ?? 0),
            preimage: recovered.preimage ?? '',
          };
        }
        this.logger.warn(`Fallo al pagar invoice: ${this.errorMessage(error)}`);
        return {
          success: false,
          reason: 'payment_failed',
          message: this.errorMessage(error),
        };
      }
    });
  }

  private createAdvertiserClient(encryptedNwcUrl: string): NWCClient {
    let client = this.advertiserClients.get(encryptedNwcUrl);
    if (!client) {
      client = new NWCClient({
        nostrWalletConnectUrl: this.cryptoService.decrypt(encryptedNwcUrl),
      });
      this.advertiserClients.set(encryptedNwcUrl, client);
    }
    return client;
  }

  private createPlatformClient(): NWCClient {
    if (this.platformClient) return this.platformClient;
    const nwcUrl = process.env.PLATFORM_NWC_URL;
    if (!nwcUrl) throw new Error('PLATFORM_NWC_URL no está configurada.');
    this.platformClient = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
    return this.platformClient;
  }

  private withAdvertiserClient<T>(
    encryptedNwcUrl: string,
    operation: (client: NWCClient) => Promise<T>,
  ): Promise<T> {
    return this.runExclusive(`advertiser:${encryptedNwcUrl}`, () =>
      operation(this.createAdvertiserClient(encryptedNwcUrl)),
    );
  }

  private withPlatformClient<T>(
    operation: (client: NWCClient) => Promise<T>,
  ): Promise<T> {
    return this.runExclusive('platform', () =>
      operation(this.createPlatformClient()),
    );
  }

  private async runExclusive<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.operationQueues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.operationQueues.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.operationQueues.get(key) === tail) {
        this.operationQueues.delete(key);
      }
    }
  }

  private async assertMethods(
    client: NWCClient,
    required: string[],
  ): Promise<void> {
    const info = await client.getWalletServiceInfo();
    const methods = new Set((info.capabilities ?? []).map(String));
    const missing = required.filter((method) => !methods.has(method));
    if (missing.length > 0) {
      throw new Error(`NWC_METHODS_MISSING:${missing.join(',')}`);
    }
  }

  private async lookupOutgoing(client: NWCClient, invoice: string) {
    try {
      return await this.retryNwcPublish('lookup_invoice', () =>
        client.lookupInvoice({ invoice }),
      );
    } catch {
      return null;
    }
  }

  private async retryNwcPublish<T>(
    operationName: string,
    operation: () => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isPublishFailure(error) || attempt >= maxAttempts) {
          throw error;
        }
        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(
          `${operationName} no pudo publicarse en el relay; reintento ${attempt + 1}/${maxAttempts} en ${delayMs}ms.`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private isPublishFailure(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'Nip47PublishError' ||
        error.message.includes('failed to publish'))
    );
  }

  private async fetchUserMetadata(
    pubkey: string,
    relays: string[],
  ): Promise<Event | null> {
    try {
      const events = await this.nostrService.pool.querySync(relays, {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      });
      return events[0] ?? null;
    } catch (error) {
      this.logger.warn(
        `Error al obtener metadata del usuario ${pubkey}: ${this.errorMessage(error)}`,
      );
      return null;
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
    const body = (await response.json()) as {
      pr?: string;
      status?: string;
      reason?: string;
    };
    if (body.status === 'ERROR') throw new Error(body.reason ?? 'Error LNURL');
    if (!body.pr) throw new Error('LNURL callback no devolvió invoice');
    return body.pr;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
