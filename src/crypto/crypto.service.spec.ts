import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);

    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
      return;
    }

    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('encrypts and decrypts with a valid AES-256 key', () => {
    const encrypted = service.encrypt('valor sensible');

    expect(service.decrypt(encrypted)).toBe('valor sensible');
  });

  it('rejects a 64-character key that is not hexadecimal', () => {
    process.env.ENCRYPTION_KEY = 'z'.repeat(64);

    expect(() => new CryptoService()).toThrow(
      'ENCRYPTION_KEY debe ser una cadena hex de 64 caracteres (32 bytes).',
    );
  });
});
