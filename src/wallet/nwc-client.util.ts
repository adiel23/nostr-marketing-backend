import { NWCClient } from '@getalby/sdk';
import { resolvePublicAddress } from 'src/common/network-security.util';

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
 * Valida el/los relay(s) de una URI NWC antes de que el SDK abra ninguna
 * conexion: solo wss://, sin credenciales, sin redes locales tras
 * resolver DNS. La URI NWC proviene de un campo de campana controlado
 * por el usuario que la crea, por lo que es superficie SSRF igual que
 * el callback LNURL.
 */
async function validateNwcRelays(nostrWalletConnectUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(nostrWalletConnectUrl);
  } catch {
    throw new Error('La URL de conexion NWC no es valida.');
  }

  const relayValues = parsed.searchParams.getAll('relay');
  if (relayValues.length === 0) {
    throw new Error('La URL de conexion NWC no especifica un relay.');
  }

  for (const relayValue of relayValues) {
    await validateNwcRelayUrl(relayValue);
  }
}

async function validateNwcRelayUrl(relayValue: string): Promise<void> {
  let relayUrl: URL;
  try {
    relayUrl = new URL(relayValue);
  } catch {
    throw new Error('El relay de la conexion NWC no es una URL valida.');
  }

  if (relayUrl.protocol !== 'wss:') {
    throw new Error('El relay de la conexion NWC debe usar wss://.');
  }

  if (relayUrl.username || relayUrl.password) {
    throw new Error(
      'El relay de la conexion NWC no puede incluir credenciales.',
    );
  }

  const hostname = relayUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error(
      'El relay de la conexion NWC no puede apuntar a una red local.',
    );
  }

  // Resuelve y bloquea si toda direccion es privada/local. No elimina la
  // ventana de DNS-rebinding (el SDK reconecta con su propio transporte
  // WebSocket, fuera de nuestro control), pero bloquea el caso comun de
  // apuntar directamente a una IP o hostname privado.
  await resolvePublicAddress(hostname);
}

/**
 * Creates an NWC client, optionally bypassing NIP-47 service-info discovery
 * for wallets that only support the legacy NIP-04 encryption mode.
 */
export async function createNwcClient(
  nostrWalletConnectUrl: string,
): Promise<NWCClient> {
  await validateNwcRelays(nostrWalletConnectUrl);

  const client = new NWCClient({ nostrWalletConnectUrl });

  if (shouldForceNip04()) {
    (client as unknown as NwcClientWithEncryptionOverride)._encryptionType =
      'nip04';
  }

  return client;
}
