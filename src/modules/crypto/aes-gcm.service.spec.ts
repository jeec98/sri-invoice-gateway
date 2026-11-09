import { describe, it, expect, beforeEach } from 'vitest';
import { AesGcmService } from './aes-gcm.service';

describe('AesGcmService', () => {
  let service: AesGcmService;
  const masterKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    process.env.MASTER_ENCRYPTION_KEY = masterKeyHex;
    service = new AesGcmService();
  });

  it('should encrypt and decrypt a certificate password accurately using AES-256-GCM', () => {
    const plainPassword = 'MySuperSecretP12Password!2026';
    const encrypted = service.encrypt(plainPassword);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).not.toEqual(plainPassword);

    const decrypted = service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
    expect(decrypted).toBe(plainPassword);
  });

  it('should generate unique IVs and ciphertexts for identical plaintexts', () => {
    const plainPassword = 'SamePassword123';
    const first = service.encrypt(plainPassword);
    const second = service.encrypt(plainPassword);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('should throw an error if authTag or ciphertext is tampered with', () => {
    const plainPassword = 'TamperTestPassword';
    const encrypted = service.encrypt(plainPassword);

    const tamperedTag = Buffer.alloc(16, 0).toString('base64');
    expect(() => service.decrypt(encrypted.ciphertext, encrypted.iv, tamperedTag)).toThrow();
  });

  it('should encrypt and decrypt a binary .p12 certificate buffer using AES-256-GCM', () => {
    const rawP12Bytes = Buffer.from([0x30, 0x82, 0x05, 0x20, 0x02, 0x01, 0x03, 0xaa, 0xbb, 0xcc]);
    const encryptedBuffer = service.encryptBuffer(rawP12Bytes);

    expect(encryptedBuffer.subarray(0, 4).toString('ascii')).toBe('AGCM');
    expect(encryptedBuffer.equals(rawP12Bytes)).toBe(false);

    const decryptedBuffer = service.decryptBuffer(encryptedBuffer);
    expect(decryptedBuffer.equals(rawP12Bytes)).toBe(true);
  });

  it('should reject unencrypted or tampered binary buffers on decryptBuffer', () => {
    const plainBuffer = Buffer.from('unencrypted-p12-binary-content-that-is-over-32-bytes-long');
    expect(() => service.decryptBuffer(plainBuffer)).toThrow(/INVALID_ENCRYPTED_BUFFER/);

    const encrypted = service.encryptBuffer(Buffer.from('valid-p12-content'));
    encrypted[encrypted.length - 1] ^= 0xff; // Tamper with last ciphertext byte
    expect(() => service.decryptBuffer(encrypted)).toThrow();
  });
});
