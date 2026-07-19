import { EventEmitter } from 'node:events';

jest.mock('@getalby/sdk', () => ({ NWCClient: jest.fn() }));
jest.mock('@getalby/lightning-tools/bolt11', () => ({
  decodeInvoice: jest.fn(),
}));
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
jest.mock('nostr-tools', () => ({
  nip57: {
    getZapEndpoint: jest.fn(),
    makeZapRequest: jest.fn(),
  },
}));
jest.mock('nostr-tools/pool', () => ({ SimplePool: jest.fn() }));
jest.mock('nostr-tools/pure', () => ({ finalizeEvent: jest.fn() }));
jest.mock('src/nostr/nostr-keys.util', () => ({
  getPlatformSecretKey: jest.fn(() => new Uint8Array(32)),
  getRelayUrl: jest.fn(() => 'wss://relay.example'),
  getZapRelayUrl: jest.fn(() => 'wss://zap-relay.example'),
}));

import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import { Test, TestingModule } from '@nestjs/testing';
import { decodeInvoice } from '@getalby/lightning-tools/bolt11';
import { NWCClient } from '@getalby/sdk';
import { nip57 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { CryptoService } from 'src/crypto/crypto.service';
import {
  assertInvoiceAmount,
  msatsToSatsCeil,
  validateLnurlCallbackUrl,
  WalletService,
} from './wallet.service';

const httpsRequest = https.request as unknown as jest.Mock;

interface FakeResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  resume: jest.Mock;
}

describe('WalletService', () => {
  let service: WalletService;
  const decrypt = jest.fn();
  const payInvoice = jest.fn();
  const close = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: CryptoService, useValue: { decrypt } },
      ],
    }).compile();

    service = module.get(WalletService);
    decrypt.mockReturnValue('nostr+walletconnect://wallet');
    (lookup as unknown as jest.Mock).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    (SimplePool as unknown as jest.Mock).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([{ id: 'metadata' }]),
      close: jest.fn(),
    }));
    (nip57.getZapEndpoint as unknown as jest.Mock).mockResolvedValue(
      'https://pay.example/callback',
    );
    (nip57.makeZapRequest as unknown as jest.Mock).mockReturnValue({});
    (finalizeEvent as jest.Mock).mockReturnValue({ id: 'zap-request' });
    (decodeInvoice as jest.Mock).mockReturnValue({ millisatoshi: 5_000 });
    payInvoice.mockResolvedValue({ fees_paid: 1_500 });
    (NWCClient as unknown as jest.Mock).mockImplementation(() => ({
      payInvoice,
      close,
    }));
    mockLnurlResponse(JSON.stringify({ pr: 'lnbc-test' }));
  });

  it('rounds NIP-47 fees in msats up to ledger sats', () => {
    expect(msatsToSatsCeil(0)).toBe(0);
    expect(msatsToSatsCeil(1)).toBe(1);
    expect(msatsToSatsCeil(1_000)).toBe(1);
    expect(msatsToSatsCeil(1_001)).toBe(2);
  });

  it('rejects unsafe LNURL callback targets before connecting', () => {
    expect(() =>
      validateLnurlCallbackUrl('http://pay.example/callback'),
    ).toThrow('HTTPS');
    expect(() =>
      validateLnurlCallbackUrl('https://localhost/callback'),
    ).toThrow('red local');
    expect(() => validateLnurlCallbackUrl('https://10.0.0.1/callback')).toThrow(
      'red local',
    );
  });

  it('does not connect when the callback resolves to a private address', async () => {
    (lookup as unknown as jest.Mock).mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ]);

    const result = await service.sendZap(createInput());

    expect(result).toMatchObject({ success: false, reason: 'payment_failed' });
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('rejects LNURL responses larger than the configured limit', async () => {
    mockLnurlResponse('{}', 200, {
      'content-length': (16 * 1024 + 1).toString(),
    });

    const result = await service.sendZap(createInput());

    expect(result).toMatchObject({ success: false, reason: 'payment_failed' });
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('pays only an invoice with the requested amount and converts fees to sats', async () => {
    await expect(service.sendZap(createInput())).resolves.toEqual({
      success: true,
      feesPaid: 2,
    });

    expect(payInvoice).toHaveBeenCalledWith({
      invoice: 'lnbc-test',
      amount: 5_000,
    });
    expect(nip57.makeZapRequest).toHaveBeenCalledWith(
      expect.objectContaining({ relays: ['wss://zap-relay.example'] }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it('does not pay a mismatched invoice amount', async () => {
    (decodeInvoice as jest.Mock).mockReturnValue({ millisatoshi: 5_001 });

    const result = await service.sendZap(createInput());

    expect(result).toMatchObject({ success: false, reason: 'payment_failed' });
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('does not follow redirects from the LNURL callback', async () => {
    mockLnurlResponse('', 302);

    const result = await service.sendZap(createInput());

    expect(result).toMatchObject({ success: false, reason: 'payment_failed' });
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('rejects malformed or mismatched BOLT11 amounts', () => {
    (decodeInvoice as jest.Mock).mockReturnValue(null);
    expect(() => assertInvoiceAmount('invalid', 5_000)).toThrow('no coincide');

    (decodeInvoice as jest.Mock).mockReturnValue({ millisatoshi: 5_001 });
    expect(() => assertInvoiceAmount('lnbc-test', 5_000)).toThrow(
      'no coincide',
    );
  });
});

function createInput() {
  return {
    encryptedNwcUrl: 'encrypted-wallet',
    targetPubkey: 'target-pubkey',
    targetEventId: 'target-event',
    amountSats: 5,
  };
}

function mockLnurlResponse(
  body: string,
  statusCode = 200,
  headers: Record<string, string | string[] | undefined> = {},
) {
  const response = Object.assign(new EventEmitter(), {
    statusCode,
    headers: {
      'content-length': Buffer.byteLength(body).toString(),
      ...headers,
    },
    resume: jest.fn(),
  }) as FakeResponse;
  const request = Object.assign(new EventEmitter(), {
    setTimeout: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  });
  let requestCallback: ((value: FakeResponse) => void) | undefined;

  httpsRequest.mockImplementation(
    (_options: unknown, callback: (value: FakeResponse) => void) => {
      requestCallback = callback;
      return request;
    },
  );

  request.end.mockImplementation(() => {
    queueMicrotask(() => {
      requestCallback?.(response);
      if (statusCode >= 200 && statusCode < 300) {
        response.emit('data', Buffer.from(body));
        response.emit('end');
      }
    });
  });

  return request;
}
