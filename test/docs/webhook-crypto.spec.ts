import { describe, it, expect } from 'vitest';
import {
  computeHmacSha256,
  verifyWebhookSignature,
  validateJsonPayload,
} from '../../docs/components/utils/webhook-crypto';

describe('Webhook HMAC-SHA256 Crypto Utilities', () => {
  const sampleSecret = 'whsec_test_secret_123';
  const samplePayload = JSON.stringify({
    event: 'sri.invoice.completed',
    status: 'AUTORIZADO',
    claveAcceso: '0711202601179001167400110010010000001231234567818',
  });

  describe('computeHmacSha256', () => {
    it('computes HMAC-SHA256 signature formatted as sha256=<hex> using Web Crypto API', async () => {
      const signature = await computeHmacSha256(samplePayload, sampleSecret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify deterministic test vector
      const simpleSig = await computeHmacSha256('payload', 'secret');
      expect(simpleSig).toBe(
        'sha256=b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4',
      );
    });
  });

  describe('verifyWebhookSignature', () => {
    it('confirms validity when provided signature exactly matches computed signature', async () => {
      const computed = await computeHmacSha256(samplePayload, sampleSecret);
      const result = await verifyWebhookSignature(samplePayload, sampleSecret, computed);

      expect(result.isValid).toBe(true);
      expect(result.match).toBe(true);
      expect(result.computedSignature).toBe(computed);
      expect(result.providedSignature).toBe(computed);
      expect(result.error).toBeUndefined();
    });

    it('detects mismatch when signature is incorrect or tampered', async () => {
      const tamperedHeader =
        'sha256=0000000000000000000000000000000000000000000000000000000000000000';
      const result = await verifyWebhookSignature(samplePayload, sampleSecret, tamperedHeader);

      expect(result.isValid).toBe(false);
      expect(result.match).toBe(false);
      expect(result.providedSignature).toBe(tamperedHeader);
      expect(result.error).toContain('Discrepancia detectada');
    });

    it('handles empty webhook secret by returning descriptive error', async () => {
      const result = await verifyWebhookSignature(samplePayload, '', 'sha256=123');

      expect(result.isValid).toBe(false);
      expect(result.match).toBe(false);
      expect(result.error).toContain('El secreto del webhook es obligatorio');
    });
  });

  describe('validateJsonPayload', () => {
    it('validates structurally sound JSON string', () => {
      const valid = validateJsonPayload('{"test": true}');
      expect(valid.isValidJson).toBe(true);
      expect(valid.error).toBeUndefined();
    });

    it('detects syntax error in invalid JSON string', () => {
      const invalid = validateJsonPayload('{"test": unquoted}');
      expect(invalid.isValidJson).toBe(false);
      expect(invalid.error).toBeDefined();
    });
  });
});
