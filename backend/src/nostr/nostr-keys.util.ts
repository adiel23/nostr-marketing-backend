import { hexToBytes } from '@noble/hashes/utils';
import { decode } from 'nostr-tools/nip19';

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

  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error('PLATFORM_NSEC debe ser un nsec o hex de 64 caracteres.');
  }

  return hexToBytes(secret);
}

export function getPlatformPublicKey(): string {
  const publicKey = process.env.PLATFORM_NPUB;

  if (!publicKey) {
    throw new Error('PLATFORM_NPUB no está configurada.');
  }

  // Caso 1: Si viene en formato NIP-19 (npub1...)
  if (publicKey.startsWith('npub1')) {

    const decoded = decode(publicKey);

    if (decoded.type !== 'npub') {
      throw new Error('PLATFORM_NPUB no es un npub válido.');
    }

    return decoded.data;
  }

  // Caso 2: Si viene en formato Hexadecimal puro
  if (!/^[a-f0-9]{64}$/i.test(publicKey)) {
    throw new Error('PLATFORM_NPUB debe ser un npub o hex de 64 caracteres.');
  }

  return publicKey;
}

export function getRelayUrl(): string {
  return process.env.NOSTR_RELAY_URL ?? 'wss://relay.damus.io';
}
