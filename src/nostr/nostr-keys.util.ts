import { decode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { isHex64 } from 'src/common/type-guards.util';

export function getPlatformSecretKey(): Uint8Array {
  const secret = process.env.PLATFORM_NSEC;

  if (!secret) {
    throw new Error('PLATFORM_NSEC no está configurada.');
  }

  if (secret.startsWith('nsec1')) {
    const decoded = decode(secret);
    if (decoded.type !== 'nsec') {
      throw new Error('PLATFORM_NSEC no es un nsec válido.');
    }
    return decoded.data;
  }

  if (!isHex64(secret)) {
    throw new Error('PLATFORM_NSEC debe ser un nsec o hex de 64 caracteres.');
  }

  return Uint8Array.from(Buffer.from(secret, 'hex'));
}

export function getPlatformPublicKey(): string {
  const configuredPublicKey = process.env.PLATFORM_NPUB;

  if (!configuredPublicKey) {
    throw new Error('PLATFORM_NPUB no está configurada.');
  }

  let publicKey: string;

  // Caso 1: Si viene en formato NIP-19 (npub1...)
  if (configuredPublicKey.startsWith('npub1')) {
    const decoded = decode(configuredPublicKey);

    if (decoded.type !== 'npub') {
      throw new Error('PLATFORM_NPUB no es un npub válido.');
    }

    publicKey = decoded.data;
  } else {
    // Caso 2: Si viene en formato Hexadecimal puro
    if (!isHex64(configuredPublicKey)) {
      throw new Error('PLATFORM_NPUB debe ser un npub o hex de 64 caracteres.');
    }

    publicKey = configuredPublicKey.toLowerCase();
  }

  const derivedPublicKey = getPublicKey(getPlatformSecretKey());
  if (publicKey !== derivedPublicKey) {
    throw new Error('PLATFORM_NSEC y PLATFORM_NPUB no corresponden entre sí.');
  }

  return derivedPublicKey;
}

export function getRelayUrl(): string {
  return process.env.NOSTR_RELAY_URL ?? 'wss://relay.damus.io';
}

/**
 * Relay advertised in NIP-57 zap requests. It can differ from the relay the
 * application listens to when that listener is private or otherwise not
 * reachable by the recipient's LNURL server.
 */
export function getZapRelayUrl(): string {
  return process.env.NOSTR_ZAP_RELAY_URL ?? getRelayUrl();
}

/**
 * Relay used for public promotional replies. This can differ from the relay
 * the application listens to, for example when the listener is an isolated
 * test relay but replies must be visible to Nostr clients.
 */
export function getPublishRelayUrl(): string {
  return process.env.NOSTR_PUBLISH_RELAY_URL ?? getRelayUrl();
}
