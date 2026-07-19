jest.mock('@getalby/sdk', () => ({ NWCClient: jest.fn() }));
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { lookup } from 'node:dns/promises';
import { NWCClient } from '@getalby/sdk';
import { createNwcClient } from './nwc-client.util';

describe('createNwcClient', () => {
  const originalForceNip04 = process.env.NWC_FORCE_NIP04;

  beforeEach(() => {
    (lookup as unknown as jest.Mock).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
  });

  afterEach(() => {
    if (originalForceNip04 === undefined) {
      delete process.env.NWC_FORCE_NIP04;
    } else {
      process.env.NWC_FORCE_NIP04 = originalForceNip04;
    }
    jest.clearAllMocks();
  });

  const validUrl = 'nostr+walletconnect://example?relay=wss://relay.example';

  it('forces NIP-04 only when configured', async () => {
    const client = {};
    (NWCClient as unknown as jest.Mock).mockImplementation(() => client);
    process.env.NWC_FORCE_NIP04 = 'true';

    await expect(createNwcClient(validUrl)).resolves.toBe(client);
    expect((client as { _encryptionType?: string })._encryptionType).toBe(
      'nip04',
    );
  });

  it('rejects invalid override values', async () => {
    process.env.NWC_FORCE_NIP04 = 'yes';

    await expect(createNwcClient(validUrl)).rejects.toThrow(
      'NWC_FORCE_NIP04 debe ser true o false.',
    );
  });

  it('rejects a connection URL that is not a valid URL', async () => {
    await expect(createNwcClient('not-a-url')).rejects.toThrow(
      'La URL de conexion NWC no es valida.',
    );
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a connection URL without a relay parameter', async () => {
    await expect(
      createNwcClient('nostr+walletconnect://example'),
    ).rejects.toThrow('no especifica un relay');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a relay that does not use wss://', async () => {
    await expect(
      createNwcClient('nostr+walletconnect://example?relay=ws://relay.example'),
    ).rejects.toThrow('debe usar wss://');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a relay embedding credentials', async () => {
    await expect(
      createNwcClient(
        'nostr+walletconnect://example?relay=wss://user:pass@relay.example',
      ),
    ).rejects.toThrow('no puede incluir credenciales');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a relay pointing at localhost or .local', async () => {
    await expect(
      createNwcClient('nostr+walletconnect://example?relay=wss://localhost'),
    ).rejects.toThrow('red local');
    await expect(
      createNwcClient(
        'nostr+walletconnect://example?relay=wss://internal.local',
      ),
    ).rejects.toThrow('red local');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a relay literal IP in a private or reserved range', async () => {
    (lookup as unknown as jest.Mock).mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ]);

    await expect(
      createNwcClient('nostr+walletconnect://example?relay=wss://10.0.0.5'),
    ).rejects.toThrow('red privada o local');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('rejects a relay hostname that resolves to a private address', async () => {
    (lookup as unknown as jest.Mock).mockResolvedValue([
      { address: '192.168.1.10', family: 4 },
    ]);

    await expect(createNwcClient(validUrl)).rejects.toThrow(
      'red privada o local',
    );
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('validates every relay when the URL declares more than one', async () => {
    (lookup as unknown as jest.Mock)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      createNwcClient(
        'nostr+walletconnect://example?relay=wss://relay-one.example&relay=wss://relay-two.example',
      ),
    ).rejects.toThrow('red privada o local');
    expect(NWCClient).not.toHaveBeenCalled();
  });

  it('creates a client once the relay resolves to a public address', async () => {
    const client = {};
    (NWCClient as unknown as jest.Mock).mockImplementation(() => client);

    await expect(createNwcClient(validUrl)).resolves.toBe(client);
    expect(lookup).toHaveBeenCalledWith('relay.example', {
      all: true,
      verbatim: true,
    });
  });
});
