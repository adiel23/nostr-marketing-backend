jest.mock('node:dns/promises', () => ({
  lookup: jest
    .fn()
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { NWCClient } from '@getalby/sdk';
import { createNwcClient } from './nwc-client.util';

const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const VALID_NWC_URL = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss://relay.example&secret=${SECRET}`;

describe('createNwcClient contract with the real @getalby/sdk NWCClient', () => {
  const originalForceNip04 = process.env.NWC_FORCE_NIP04;

  afterEach(() => {
    if (originalForceNip04 === undefined) {
      delete process.env.NWC_FORCE_NIP04;
    } else {
      process.env.NWC_FORCE_NIP04 = originalForceNip04;
    }
  });

  it('creates a real NWCClient instance for a valid connection URL', async () => {
    const client = await createNwcClient(VALID_NWC_URL);
    expect(client).toBeInstanceOf(NWCClient);
    client.close();
  });

  it('forcing NIP-04 actually changes the SDK-reported encryptionType', async () => {
    process.env.NWC_FORCE_NIP04 = 'true';

    const client = await createNwcClient(VALID_NWC_URL);
    try {
      // Si el SDK renombra o elimina el campo interno `_encryptionType`,
      // este getter publico deja de reflejar el override y este test
      // debe fallar, alertando de que nwc-client.util.ts quedo desfasado.
      expect(client.encryptionType).toBe('nip04');
    } finally {
      client.close();
    }
  });
});
