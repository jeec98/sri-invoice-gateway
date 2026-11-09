import { describe, it, expect } from 'vitest';
import {
  calculateModulo11,
  verifyModulo11,
  generateTestAccessKey,
} from '../../docs/components/utils/modulo11';

describe('Modulo 11 Check Digit & Access Key Utilities', () => {
  describe('calculateModulo11 - Happy Path', () => {
    it('computes check digit from 48-digit input (Happy Path)', () => {
      // 48 digits base key
      const base48 = '071120260117900116740011001001000000123123456781';
      const result = calculateModulo11(base48);

      expect(result.isValid).toBe(true);
      expect(result.is48Digits).toBe(true);
      expect(result.cleanInput).toBe(base48);
      expect(result.computedCheckDigit).toBe(8);
      expect(result.fullAccessKey).toBe(`${base48}8`);
      expect(result.sum).toBe(487);
      expect(result.remainder).toBe(3);
      expect(result.breakdown).toHaveLength(48);

      // Verify breakdown properties
      const firstRow = result.breakdown[0];
      expect(firstRow.position).toBe(1);
      expect(firstRow.digit).toBe(0);

      const lastRow = result.breakdown[47];
      expect(lastRow.position).toBe(48);
      expect(lastRow.digit).toBe(1);
      expect(lastRow.weight).toBe(2);
      expect(lastRow.product).toBe(2);
    });
  });

  describe('verifyModulo11 - 49-digit access key verification', () => {
    it('verifies valid 49-digit access key', () => {
      const validKey49 = '0711202601179001167400110010010000001231234567818';
      const result = verifyModulo11(validKey49);

      expect(result.isValid).toBe(true);
      expect(result.is49Digits).toBe(true);
      expect(result.providedCheckDigit).toBe(8);
      expect(result.computedCheckDigit).toBe(8);
      expect(result.cleanInput).toBe(validKey49);
      expect(result.fullAccessKey).toBe(validKey49);
    });

    it('rejects invalid 49-digit access key with mismatched check digit', () => {
      // 49th digit is 9 instead of 8
      const invalidKey49 = '0711202601179001167400110010010000001231234567819';
      const result = verifyModulo11(invalidKey49);

      expect(result.isValid).toBe(false);
      expect(result.is49Digits).toBe(true);
      expect(result.providedCheckDigit).toBe(9);
      expect(result.computedCheckDigit).toBe(8);
      expect(result.errorMessage).toBeDefined();
    });
  });

  describe('calculateModulo11 - Edge Cases', () => {
    it('handles remainder 0 (check digit is 0)', () => {
      // '0'.repeat(48) -> sum = 0, rem = 0 -> check digit = 0
      const input = '0'.repeat(48);
      const result = calculateModulo11(input);
      expect(result.remainder).toBe(0);
      expect(result.computedCheckDigit).toBe(0);
    });

    it('handles remainder 1 (check digit is 1)', () => {
      // '0'.repeat(47) + '6' -> sum = 6 * 2 = 12, 12 % 11 = 1 -> rem = 1 -> check digit = 1
      const input = '0'.repeat(47) + '6';
      const result = calculateModulo11(input);
      expect(result.remainder).toBe(1);
      expect(result.computedCheckDigit).toBe(1);
    });

    it('handles edge case where 11 - remainder equals 10 (maps to 1)', () => {
      // When remainder is 1, 11 - 1 = 10 -> check digit is 1
      const input = '0'.repeat(47) + '6';
      const result = calculateModulo11(input);
      expect(result.computedCheckDigit).toBe(1);
    });

    it('handles edge case where 11 - remainder equals 11 (maps to 0)', () => {
      // When remainder is 0, 11 - 0 = 11 -> check digit is 0
      const input = '0'.repeat(48);
      const result = calculateModulo11(input);
      expect(result.computedCheckDigit).toBe(0);
    });
  });

  describe('calculateModulo11 - Input Sanitization & Validation', () => {
    it('rejects input containing non-numeric characters', () => {
      const inputWithLetters = '07112026011790011674001100100100000012312345678A';
      const result = calculateModulo11(inputWithLetters);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('solo debe contener dígitos numéricos');
    });

    it('rejects input with invalid length (< 48 digits)', () => {
      const shortInput = '07112026011790011674001';
      const result = calculateModulo11(shortInput);

      expect(result.isValid).toBe(false);
      expect(result.is48Digits).toBe(false);
      expect(result.errorMessage).toContain('debe tener exactamente 48 dígitos');
    });

    it('handles input with surrounding whitespace by trimming', () => {
      const base48 = '071120260117900116740011001001000000123123456781';
      const inputWithWhitespace = `   ${base48}   \n`;
      const result = calculateModulo11(inputWithWhitespace);

      expect(result.isValid).toBe(true);
      expect(result.cleanInput).toBe(base48);
      expect(result.computedCheckDigit).toBe(8);
    });
  });

  describe('generateTestAccessKey', () => {
    it('generates a synthetic, mathematically valid 49-digit test SRI access key', () => {
      const generatedKey = generateTestAccessKey();

      expect(generatedKey).toHaveLength(49);
      expect(/^\d{49}$/.test(generatedKey)).toBe(true);

      // Verify structure components:
      // tipoComprobante: '01' (Factura)
      expect(generatedKey.slice(8, 10)).toBe('01');
      // dummy RUC: '1792146739001'
      expect(generatedKey.slice(10, 23)).toBe('1792146739001');
      // ambiente: '1' (Pruebas)
      expect(generatedKey.slice(23, 24)).toBe('1');
      // serie: estab '001' + ptoEmi '001'
      expect(generatedKey.slice(24, 30)).toBe('001001');
      // secuencial: '000000001'
      expect(generatedKey.slice(30, 39)).toBe('000000001');
      // tipoEmision: '1'
      expect(generatedKey.slice(47, 48)).toBe('1');

      // Verify mathematical validity
      const verification = verifyModulo11(generatedKey);
      expect(verification.isValid).toBe(true);
      expect(verification.computedCheckDigit).toBe(Number(generatedKey.slice(48, 49)));
    });
  });
});
