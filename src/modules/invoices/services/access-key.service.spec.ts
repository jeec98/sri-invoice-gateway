import { describe, it, expect, beforeEach } from 'vitest';
import { AccessKeyService } from './access-key.service';

describe('AccessKeyService', () => {
  let service: AccessKeyService;

  beforeEach(() => {
    service = new AccessKeyService();
  });

  it('should generate a 49-digit numeric access key with exact SRI structure and Modulo 11 check digit', () => {
    const key = service.generateAccessKey({
      fechaEmision: '07/11/2026', // ddmmaaaa -> 07112026
      codDoc: '01',
      ruc: '1790011674001',
      ambiente: '1',
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000123',
      codigoNumerico: '12345678',
      tipoEmision: '1',
    });

    expect(key).toHaveLength(49);
    expect(/^\d{49}$/.test(key)).toBe(true);
    expect(key.slice(0, 8)).toBe('07112026');
    expect(key.slice(8, 10)).toBe('01');
    expect(key.slice(10, 23)).toBe('1790011674001');
    expect(key.slice(23, 24)).toBe('1');
    expect(key.slice(24, 30)).toBe('001001');
    expect(key.slice(30, 39)).toBe('000000123');
    expect(key.slice(39, 47)).toBe('12345678');
    expect(key.slice(47, 48)).toBe('1');

    const expectedDv = service.computeModulo11(key.slice(0, 48));
    expect(Number(key.slice(48, 49))).toBe(expectedDv);
  });

  it('should apply Modulo 11 rules accurately: remainder 0 -> 0, remainder 1 -> 1, else 11 - remainder', () => {
    // Craft inputs that produce specific remainders with weights [2,3,4,5,6,7] right-to-left
    // Single digit '0' -> sum = 0 * 2 = 0 -> rem 0 -> DV = 0
    expect(service.computeModulo11('0'.repeat(48))).toBe(0);

    // Last digit '6', all others '0' -> sum = 6 * 2 = 12 -> 12 % 11 = 1 -> rem 1 -> DV = 1
    expect(service.computeModulo11('0'.repeat(47) + '6')).toBe(1);

    // Last digit '2', all others '0' -> sum = 2 * 2 = 4 -> 4 % 11 = 4 -> DV = 11 - 4 = 7
    expect(service.computeModulo11('0'.repeat(47) + '2')).toBe(7);
  });

  it('should auto-pad secuencial (9 digits), estab/ptoEmi (3 digits), and codigoNumerico (8 digits)', () => {
    const key = service.generateAccessKey({
      fechaEmision: '2026-11-07',
      codDoc: '01',
      ruc: '1790011674001',
      ambiente: '2',
      estab: '1',
      ptoEmi: '2',
      secuencial: '45',
      codigoNumerico: '99',
      tipoEmision: '1',
    });

    expect(key).toHaveLength(49);
    expect(key.slice(0, 8)).toBe('07112026');
    expect(key.slice(24, 30)).toBe('001002');
    expect(key.slice(30, 39)).toBe('000000045');
    expect(key.slice(39, 47)).toBe('00000099');
  });
});

