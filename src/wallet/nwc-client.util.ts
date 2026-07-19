import { NWCClient } from '@getalby/sdk';

type NwcClientWithEncryptionOverride = {
  _encryptionType?: 'nip04';
};

function shouldForceNip04(): boolean {
  const value = process.env.NWC_FORCE_NIP04;
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;

  throw new Error('NWC_FORCE_NIP04 debe ser true o false.');
}

/**
 * Creates an NWC client, optionally bypassing NIP-47 service-info discovery
 * for wallets that only support the legacy NIP-04 encryption mode.
 */
export function createNwcClient(nostrWalletConnectUrl: string): NWCClient {
  const client = new NWCClient({ nostrWalletConnectUrl });

  if (shouldForceNip04()) {
    (client as unknown as NwcClientWithEncryptionOverride)._encryptionType =
      'nip04';
  }

  return client;
}
