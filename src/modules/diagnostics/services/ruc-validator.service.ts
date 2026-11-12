import { Injectable } from '@nestjs/common';
import { DiagnosticErrorCode, RucType } from '../constants/diagnostic-error-codes';
import { DiagnosticIssueDto, RucDiagnosticDto } from '../dto/diagnostic-response.dto';

export const ECUADOR_PROVINCES: Record<string, string> = {
  '01': 'Azuay',
  '02': 'Bolívar',
  '03': 'Cañar',
  '04': 'Carchi',
  '05': 'Cotopaxi',
  '06': 'Chimborazo',
  '07': 'El Oro',
  '08': 'Esmeraldas',
  '09': 'Guayas',
  '10': 'Imbabura',
  '11': 'Loja',
  '12': 'Los Ríos',
  '13': 'Manabí',
  '14': 'Morona Santiago',
  '15': 'Napo',
  '16': 'Pastaza',
  '17': 'Pichincha',
  '18': 'Tungurahua',
  '19': 'Zamora Chinchipe',
  '20': 'Galápagos',
  '21': 'Sucumbíos',
  '22': 'Orellana',
  '23': 'Santo Domingo de los Tsáchilas',
  '24': 'Santa Elena',
  '30': 'Ecuatorianos en el Exterior',
};

@Injectable()
export class RucValidatorService {
  /**
   * Validates an Ecuadorian 13-digit RUC based on official SRI mathematical rules
   * for Natural Persons (Modulo 10), Private Juridical Entities (Modulo 11 base 9),
   * and Public State Entities (Modulo 11 base 8).
   */
  validate(rucInput: string): RucDiagnosticDto {
    const ruc = (rucInput || '').trim();
    const issues: DiagnosticIssueDto[] = [];

    // 1. Length and numeric verification
    if (!/^\d{13}$/.test(ruc)) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_LENGTH,
        message: 'El RUC debe tener exactamente 13 dígitos numéricos.',
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction: 'Asegúrese de ingresar un RUC de 13 dígitos numéricos válidos.',
      });

      return {
        ruc,
        isValid: false,
        type: RucType.INVALID,
        provinceCode: ruc.length >= 2 ? ruc.slice(0, 2) : '',
        provinceName: 'Desconocida',
        issues,
      };
    }

    // 2. Province verification (first 2 digits)
    const provinceCode = ruc.slice(0, 2);
    const provinceName = ECUADOR_PROVINCES[provinceCode];
    if (!provinceName) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_PROVINCE,
        message: `El código de provincia "${provinceCode}" no es válido en el territorio ecuatoriano (rango válido: 01-24, o 30).`,
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction:
          'Corrija los dos primeros dígitos del RUC correspondientes a la provincia.',
      });
    }

    const thirdDigit = Number(ruc[2]);
    let type = RucType.INVALID;

    if (thirdDigit < 6) {
      type = RucType.PERSONA_NATURAL;
      this.validatePersonaNatural(ruc, issues);
    } else if (thirdDigit === 9) {
      type = RucType.SOCIEDAD_PRIVADA;
      this.validateSociedadPrivada(ruc, issues);
    } else if (thirdDigit === 6) {
      type = RucType.SOCIEDAD_PUBLICA;
      this.validateSociedadPublica(ruc, issues);
    } else {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_THIRD_DIGIT,
        message: `El tercer dígito (${thirdDigit}) no corresponde a ningún tipo de contribuyente válido del SRI (debe ser 0-5 para personas naturales, 6 para públicas, 9 para privadas).`,
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction: 'Verifique el tercer dígito del RUC.',
      });
    }

    const isValid = issues.length === 0;

    return {
      ruc,
      isValid,
      type,
      provinceCode,
      provinceName: provinceName || 'Desconocida',
      issues,
    };
  }

  /**
   * Persona Natural (Módulo 10 sobre cédula base de 9 dígitos + 10mo dígito verificador).
   * Coeficientes: [2, 1, 2, 1, 2, 1, 2, 1, 2].
   * Dígitos 11-13 deben ser >= 001.
   */
  private validatePersonaNatural(ruc: string, issues: DiagnosticIssueDto[]): void {
    const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let sum = 0;

    for (let i = 0; i < 9; i++) {
      let product = Number(ruc[i]) * coefficients[i];
      if (product >= 10) {
        product -= 9;
      }
      sum += product;
    }

    const mod = sum % 10;
    const expectedCheckDigit = mod === 0 ? 0 : 10 - mod;
    const actualCheckDigit = Number(ruc[9]);

    if (expectedCheckDigit !== actualCheckDigit) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT,
        message: `El dígito verificador (${actualCheckDigit}) no coincide con el calculado (${expectedCheckDigit}) según el algoritmo Módulo 10.`,
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction: 'Verifique los 10 dígitos base de la cédula del contribuyente.',
      });
    }

    const establishmentSuffix = Number(ruc.slice(10, 13));
    if (establishmentSuffix < 1) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_ESTABLISHMENT_SUFFIX,
        message:
          'El sufijo de establecimiento de persona natural (dígitos 11-13) debe ser mayor o igual a "001".',
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction:
          'Asegúrese de que el RUC termine en 001 o en el número de sucursal asignado.',
      });
    }
  }

  /**
   * Sociedad Privada / Extranjeros (Módulo 11 sobre primeros 9 dígitos con pesos [4,3,2,7,6,5,4,3,2]).
   * 10mo dígito es el verificador.
   * Dígitos 11-13 deben ser >= 001.
   */
  private validateSociedadPrivada(ruc: string, issues: DiagnosticIssueDto[]): void {
    const weights = [4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;

    for (let i = 0; i < 9; i++) {
      sum += Number(ruc[i]) * weights[i];
    }

    const remainder = sum % 11;
    const expectedCheckDigit = remainder === 0 ? 0 : 11 - remainder;
    const actualCheckDigit = Number(ruc[9]);

    if (expectedCheckDigit !== actualCheckDigit) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT,
        message: `El dígito verificador de sociedad privada (${actualCheckDigit}) no coincide con el calculado (${expectedCheckDigit}) según Módulo 11.`,
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction: 'Verifique el RUC de la sociedad privada.',
      });
    }

    const establishmentSuffix = Number(ruc.slice(10, 13));
    if (establishmentSuffix < 1) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_ESTABLISHMENT_SUFFIX,
        message:
          'El sufijo de establecimiento de sociedad privada (dígitos 11-13) debe ser mayor o igual a "001".',
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction:
          'Asegúrese de que el RUC termine en 001 o en el número de sucursal activa.',
      });
    }
  }

  /**
   * Entidad Pública (Módulo 11 sobre primeros 8 dígitos con pesos [3,2,7,6,5,4,3,2]).
   * 9no dígito es el verificador.
   * 10mo dígito debe ser 0.
   * Dígitos 10-13 deben ser >= 0001.
   */
  private validateSociedadPublica(ruc: string, issues: DiagnosticIssueDto[]): void {
    const weights = [3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;

    for (let i = 0; i < 8; i++) {
      sum += Number(ruc[i]) * weights[i];
    }

    const remainder = sum % 11;
    const expectedCheckDigit = remainder === 0 ? 0 : 11 - remainder;
    const actualCheckDigit = Number(ruc[8]);

    if (expectedCheckDigit !== actualCheckDigit) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT,
        message: `El dígito verificador de entidad pública (${actualCheckDigit}) no coincide con el calculado (${expectedCheckDigit}) según Módulo 11.`,
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction: 'Verifique los primeros 9 dígitos del RUC de la institución pública.',
      });
    }

    const establishmentSuffix = Number(ruc.slice(9, 13));
    if (establishmentSuffix < 1) {
      issues.push({
        code: DiagnosticErrorCode.INVALID_RUC_ESTABLISHMENT_SUFFIX,
        message:
          'El sufijo de establecimiento de entidad pública (dígitos 10-13) debe ser mayor o igual a "0001".',
        severity: 'ERROR',
        sriOfficialCode: 46,
        recommendedAction:
          'Asegúrese de que el sufijo de establecimiento estatal comience en 0001.',
      });
    }
  }
}
