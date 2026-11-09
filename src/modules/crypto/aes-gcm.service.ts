import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface AesGcmEncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class AesGcmService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // 96-bit standard IV for AES-GCM
  private readonly binaryMagicHeader = Buffer.from('AGCM', 'ascii'); // 4-byte magic header for encrypted buffers

  private getKey(): Buffer {
    const envKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!envKey && process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'MISSING_MASTER_KEY: MASTER_ENCRYPTION_KEY environment variable is required in production.',
      );
    }

    const rawKey = envKey || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    const derived = crypto.createHash('sha256').update(rawKey).digest();
    if (derived.length !== 32) {
      throw new InternalServerErrorException('Invalid MASTER_ENCRYPTION_KEY length');
    }
    return derived;
  }

  encrypt(plaintext: string): AesGcmEncryptedPayload {
    const key = this.getKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  decrypt(ciphertextBase64: string, ivBase64: string, authTagBase64: string): string {
    const key = this.getKey();
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encryptedText = Buffer.from(ciphertextBase64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Encrypts a binary Buffer (such as a PKCS#12 .p12/.pfx certificate) using AES-256-GCM.
   * Binary layout: [4B Magic "AGCM"][12B IV][16B AuthTag][N bytes Ciphertext]
   */
  encryptBuffer(plainBuffer: Buffer): Buffer {
    const key = this.getKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([this.binaryMagicHeader, iv, authTag, ciphertext]);
  }

  /**
   * Decrypts a binary Buffer previously encrypted by encryptBuffer() using AES-256-GCM,
   * verifying the 16-byte authentication tag before returning plaintext bytes in memory.
   */
  decryptBuffer(encryptedBuffer: Buffer): Buffer {
    const minHeaderLength = this.binaryMagicHeader.length + this.ivLength + 16; // 4 + 12 + 16 = 32 bytes
    if (
      !encryptedBuffer ||
      encryptedBuffer.length < minHeaderLength ||
      !encryptedBuffer.subarray(0, 4).equals(this.binaryMagicHeader)
    ) {
      throw new InternalServerErrorException(
        'INVALID_ENCRYPTED_BUFFER: El binario del certificado no tiene un encabezado AES-256-GCM válido.',
      );
    }

    const key = this.getKey();
    const iv = encryptedBuffer.subarray(4, 16);
    const authTag = encryptedBuffer.subarray(16, 32);
    const ciphertext = encryptedBuffer.subarray(32);

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
