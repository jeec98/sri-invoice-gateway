import { describe, expect, it } from 'vitest';
import { RucValidatorService } from './ruc-validator.service';
import { DiagnosticErrorCode, RucType } from '../constants/diagnostic-error-codes';

describe('RucValidatorService', () => {
  const service = new RucValidatorService();

  describe('Persona Natural (Módulo 10)', () => {
    it('debe validar exitosamente un RUC de persona natural válido', () => {
      // 1713123457001 -> primeros 9: 171312345, check digit Modulo 10: 7, sufijo 001
      // Cédula: 1713123457
      // 1*2=2, 7*1=7, 1*2=2, 3*1=3, 1*2=2, 2*1=2, 3*2=6, 4*1=4, 5*2=10(1+0=1) -> suma: 2+7+2+3+2+2+6+4+1 = 29. 30 - 29 = 1.
      // Usemos una cédula real conocida o calculemos una matemáticamente:
      // Dígitos: 1710034065 -> 1*2=2, 7*1=7, 1*2=2, 0*1=0, 0*2=0, 3*1=3, 4*2=8, 0*1=0, 6*2=12(1+2=3) -> suma=2+7+2+0+0+3+8+0+3=25. 30-25=5. Cédula: 1710034065. RUC: 1710034065001.
      const result = service.validate('1710034065001');

      expect(result.isValid).toBe(true);
      expect(result.type).toBe(RucType.PERSONA_NATURAL);
      expect(result.provinceCode).toBe('17');
      expect(result.provinceName).toBe('Pichincha');
      expect(result.issues).toHaveLength(0);
    });

    it('debe rechazar un RUC de persona natural con dígito verificador incorrecto', () => {
      const result = service.validate('1710034069001');

      expect(result.isValid).toBe(false);
      expect(result.type).toBe(RucType.PERSONA_NATURAL);
      expect(
        result.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT),
      ).toBe(true);
    });

    it('debe rechazar un RUC con sufijo de establecimiento "000"', () => {
      const result = service.validate('1710034065000');

      expect(result.isValid).toBe(false);
      expect(
        result.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_ESTABLISHMENT_SUFFIX),
      ).toBe(true);
    });
  });

  describe('Sociedad Privada / Extranjera (Módulo 11 con pesos 4,3,2,7,6,5,4,3,2)', () => {
    it('debe validar un RUC de sociedad privada válido (ej. 1792147820001)', () => {
      // 1792147820001:
      // Digitos: 1, 7, 9, 2, 1, 4, 7, 8, 2 -> 10mo dígito verificador: 0
      // Pesos:   4, 3, 2, 7, 6, 5, 4, 3, 2
      // Productos: 4 + 21 + 18 + 14 + 6 + 20 + 28 + 24 + 4 = 119
      // 119 % 11 = 9. 11 - 9 = 2. Verifiquemos un RUC real conocido:
      // SRI Ecuador RUC: 1760013210001 (Pública: 176...)
      // Sociedad privada conocida: 1790016919001
      // 1*4=4, 7*3=21, 9*2=18, 0*7=0, 0*6=0, 1*5=5, 6*4=24, 9*3=27, 1*2=2 -> suma: 4+21+18+0+0+5+24+27+2 = 101.
      // 101 % 11 = 2. 11 - 2 = 9. Dígito verificador: 9! RUC: 1790016919001.
      const result = service.validate('1790016919001');

      expect(result.isValid).toBe(true);
      expect(result.type).toBe(RucType.SOCIEDAD_PRIVADA);
      expect(result.provinceCode).toBe('17');
      expect(result.issues).toHaveLength(0);
    });

    it('debe rechazar sociedad privada con dígito verificador incorrecto', () => {
      const result = service.validate('1790016918001');

      expect(result.isValid).toBe(false);
      expect(result.type).toBe(RucType.SOCIEDAD_PRIVADA);
      expect(
        result.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT),
      ).toBe(true);
    });
  });

  describe('Sociedad Pública (Módulo 11 con pesos 3,2,7,6,5,4,3,2)', () => {
    it('debe validar un RUC de entidad pública válido (ej. 1760000820001)', () => {
      // 1760000820001: 3er dígito = 6. Primeros 8 dígitos: 1, 7, 6, 0, 0, 0, 0, 8. 9no dígito: 2.
      // Pesos: 3, 2, 7, 6, 5, 4, 3, 2
      // 1*3=3, 7*2=14, 6*7=42, 0, 0, 0, 0, 8*2=16 -> suma: 3+14+42+16 = 75.
      // 75 % 11 = 9. 11 - 9 = 2. Dígito verificador: 2!
      // 10mo dígito debe ser 0. Sufijo: 0001. RUC: 1760000820001.
      const result = service.validate('1760000820001');

      expect(result.isValid).toBe(true);
      expect(result.type).toBe(RucType.SOCIEDAD_PUBLICA);
      expect(result.provinceCode).toBe('17');
      expect(result.issues).toHaveLength(0);
    });

    it('debe rechazar entidad pública con 10mo dígito distinto de 0 o sufijo inválido', () => {
      const result = service.validate('1760000820000');

      expect(result.isValid).toBe(false);
      expect(
        result.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_ESTABLISHMENT_SUFFIX),
      ).toBe(true);
    });
  });

  describe('Casos Borde e Invalidaciones Estructurales', () => {
    it('debe rechazar RUC con longitud diferente a 13 dígitos numéricos', () => {
      const resShort = service.validate('1790016919');
      expect(resShort.isValid).toBe(false);
      expect(resShort.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_LENGTH)).toBe(
        true,
      );

      const resAlpha = service.validate('1790016919ABC');
      expect(resAlpha.isValid).toBe(false);
      expect(resAlpha.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_LENGTH)).toBe(
        true,
      );
    });

    it('debe rechazar RUC con código de provincia inválido', () => {
      const resProv = service.validate('0090016919001');
      expect(resProv.isValid).toBe(false);
      expect(resProv.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_PROVINCE)).toBe(
        true,
      );

      const resProv25 = service.validate('2590016919001');
      expect(resProv25.isValid).toBe(false);
      expect(
        resProv25.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_PROVINCE),
      ).toBe(true);
    });

    it('debe aceptar provincia especial 30 (Ecuatorianos en el exterior)', () => {
      // 30 es código válido de provincia según registro civil / SRI
      // Calculemos una con 30 y privada:
      // 309001691?001 -> 3*4=12, 0*3=0, 9*2=18, 0, 0, 1*5=5, 6*4=24, 9*3=27, 1*2=2 -> 12+18+5+24+27+2 = 88.
      // 88 % 11 = 0. 11 - 0 => residuo 0 da verificador 0!
      // 3090016910001:
      const res30 = service.validate('3090016910001');
      expect(res30.provinceCode).toBe('30');
      expect(res30.isValid).toBe(true);
    });

    it('debe rechazar RUC con 3er dígito inválido (ej. 7 u 8)', () => {
      const res = service.validate('1770016919001');
      expect(res.isValid).toBe(false);
      expect(res.issues.some((i) => i.code === DiagnosticErrorCode.INVALID_RUC_THIRD_DIGIT)).toBe(
        true,
      );
    });
  });
});
