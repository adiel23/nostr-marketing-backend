import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateOrLocalIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;

  if (family === 4) {
    const [first, second] = address.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized)
  );
}

/**
 * Resuelve un hostname (o valida una IP literal) y devuelve una dirección
 * publicamente alcanzable, o lanza si todas las direcciones resueltas son
 * privadas/locales. Usar justo antes de conectar reduce, sin eliminar, la
 * ventana de DNS-rebinding: quien controle el socket subyacente debe
 * conectarse a la direccion ya validada en vez de volver a resolver.
 */
export async function resolvePublicAddress(hostname: string): Promise<string> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const publicAddress = addresses.find(
    ({ address }) => !isPrivateOrLocalIpAddress(address),
  );

  if (!publicAddress) {
    throw new Error(
      `El host "${hostname}" resuelve a una red privada o local.`,
    );
  }

  return publicAddress.address;
}
