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

  private getKey(): Buffer {
    const envKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!envKey && process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'MISSING_MASTER_KEY: MASTER_ENCRYPTION_KEY environment variable is required in production.',
      );
    }

    const rawKey =
      envKey || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
}

