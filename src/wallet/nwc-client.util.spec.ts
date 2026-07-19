jest.mock('@getalby/sdk', () => ({ NWCClient: jest.fn() }));

import { NWCClient } from '@getalby/sdk';
import { createNwcClient } from './nwc-client.util';

describe('createNwcClient', () => {
  const originalForceNip04 = process.env.NWC_FORCE_NIP04;

  afterEach(() => {
    if (originalForceNip04 === undefined) {
      delete process.env.NWC_FORCE_NIP04;
    } else {
      process.env.NWC_FORCE_NIP04 = originalForceNip04;
    }
    jest.clearAllMocks();
  });

  it('forces NIP-04 only when configured', () => {
    const client = {};
    (NWCClient as unknown as jest.Mock).mockImplementation(() => client);
    process.env.NWC_FORCE_NIP04 = 'true';

    expect(createNwcClient('nostr+walletconnect://example')).toBe(client);
    expect((client as { _encryptionType?: string })._encryptionType).toBe(
      'nip04',
    );
  });

  it('rejects invalid override values', () => {
    process.env.NWC_FORCE_NIP04 = 'yes';

    expect(() => createNwcClient('nostr+walletconnect://example')).toThrow(
      'NWC_FORCE_NIP04 debe ser true o false.',
    );
  });
});
