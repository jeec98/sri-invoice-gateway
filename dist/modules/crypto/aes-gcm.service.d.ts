export interface AesGcmEncryptedPayload {
    ciphertext: string;
    iv: string;
    authTag: string;
}
export declare class AesGcmService {
    private readonly algorithm;
    private readonly ivLength;
    private getKey;
    encrypt(plaintext: string): AesGcmEncryptedPayload;
    decrypt(ciphertextBase64: string, ivBase64: string, authTagBase64: string): string;
}
