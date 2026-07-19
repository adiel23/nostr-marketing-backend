jest.mock('nostr-tools/nip19', () => ({
  decode: jest.fn(),
}));

jest.mock('nostr-tools/pure', () => ({
  getPublicKey: jest.fn(() => 'b'.repeat(64)),
}));

import { getPlatformPublicKey } from './nostr-keys.util';

describe('Nostr platform keys', () => {
  const originalNsec = process.env.PLATFORM_NSEC;
  const originalNpub = process.env.PLATFORM_NPUB;
  const secretKey = `${'0'.repeat(63)}1`;

  afterEach(() => {
    if (originalNsec === undefined) {
      delete process.env.PLATFORM_NSEC;
    } else {
      process.env.PLATFORM_NSEC = originalNsec;
    }

    if (originalNpub === undefined) {
      delete process.env.PLATFORM_NPUB;
    } else {
      process.env.PLATFORM_NPUB = originalNpub;
    }
  });

  it('accepts a public key derived from the configured secret key', () => {
    const publicKey = 'b'.repeat(64);
    process.env.PLATFORM_NSEC = secretKey;
    process.env.PLATFORM_NPUB = publicKey;

    expect(getPlatformPublicKey()).toBe(publicKey);
  });

  it('rejects a configured public key that does not match the secret key', () => {
    process.env.PLATFORM_NSEC = secretKey;
    process.env.PLATFORM_NPUB = 'f'.repeat(64);

    expect(() => getPlatformPublicKey()).toThrow(
      'PLATFORM_NSEC y PLATFORM_NPUB no corresponden entre sí.',
    );
  });
});
