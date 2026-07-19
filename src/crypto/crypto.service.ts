// crypto.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { isHex64 } from 'src/common/type-guards.util';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    // Convierte la clave hex del .env a un Buffer de 32 bytes
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret || !isHex64(secret)) {
      throw new Error(
        'ENCRYPTION_KEY debe ser una cadena hex de 64 caracteres (32 bytes).',
      );
    }
    this.key = Buffer.from(secret, 'hex');
  }

  encrypt(text: string): string {
    // IV (Vector de Inicialización) de 12 bytes para GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Obtener el tag de autenticación (16 bytes)
    const authTag = cipher.getAuthTag().toString('hex');

    // Retornamos iv, authTag y el texto cifrado unidos por un separador (ej. ":")
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('El formato del texto cifrado es inválido.');
    }

    const [ivHex, authTagHex, encryptedDataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
