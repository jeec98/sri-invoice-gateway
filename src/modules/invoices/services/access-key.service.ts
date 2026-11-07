import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface AccessKeyParams {
  fechaEmision: string; // Supports "dd/mm/yyyy", "ddmmaaaa", or "yyyy-mm-dd"
  codDoc?: string; // Default "01" (Factura)
  ruc: string; // 13 digits
  ambiente: '1' | '2' | string; // 1 = Pruebas, 2 = Produccion
  estab: string; // 3 digits
  ptoEmi: string; // 3 digits
  secuencial: string; // 9 digits
  codigoNumerico?: string; // 8 digits (auto-generated if omitted)
  tipoEmision?: string; // Default "1" (Emisión Normal)
}

@Injectable()
export class AccessKeyService {
  /**
   * Builds the 49-digit Ecuadorian SRI Clave de Acceso:
   * [Fecha: ddmmaaaa (8)] + [Tipo: 01 (2)] + [RUC (13)] + [Ambiente (1)] +
   * [Serie: Estab+PtoEmi (6)] + [Secuencial (9)] + [CodigoNumerico (8)] +
   * [TipoEmision: 1 (1)] + [DigitoVerificador Modulo 11 (1)]
   */
  generateAccessKey(params: AccessKeyParams): string {
    const fecha = this.normalizeFechaToDdmmaaaa(params.fechaEmision);
    const tipoComprobante = (params.codDoc || '01').padStart(2, '0');
    const ruc = params.ruc.trim();

    if (!/^\d{13}$/.test(ruc)) {
      throw new BadRequestException('INVALID_RUC: El RUC debe tener exactamente 13 dígitos numéricos.');
    }

    const ambiente = String(params.ambiente).trim();
    if (ambiente !== '1' && ambiente !== '2') {
      throw new BadRequestException('INVALID_AMBIENTE: El ambiente debe ser "1" (Pruebas) o "2" (Producción).');
    }

    const estab = params.estab.trim().padStart(3, '0');
    const ptoEmi = params.ptoEmi.trim().padStart(3, '0');
    const serie = `${estab}${ptoEmi}`;
    const secuencial = params.secuencial.trim().padStart(9, '0');

    const codigoNumerico = params.codigoNumerico
      ? params.codigoNumerico.trim().padStart(8, '0').slice(0, 8)
      : String(crypto.randomInt(10000000, 99999999));

    const tipoEmision = (params.tipoEmision || '1').trim();

    const base48 = `${fecha}${tipoComprobante}${ruc}${ambiente}${serie}${secuencial}${codigoNumerico}${tipoEmision}`;

    if (base48.length !== 48 || !/^\d{48}$/.test(base48)) {
      throw new BadRequestException(
        `INVALID_ACCESS_KEY_BASE: La base de la clave de acceso debe tener 48 dígitos numéricos (obtenido: ${base48.length}).`,
      );
    }

    const checkDigit = this.computeModulo11(base48);
    return `${base48}${checkDigit}`;
  }

  /**
   * Computes the Modulo 11 check digit for a 48-digit string.
   * Weights from right to left: 2, 3, 4, 5, 6, 7 (cyclic).
   * Remainder 0 -> 0; Remainder 1 -> 1; Other -> 11 - remainder.
   */
  computeModulo11(base48: string): number {
    const weights = [2, 3, 4, 5, 6, 7];
    let sum = 0;
    let weightIndex = 0;

    for (let i = base48.length - 1; i >= 0; i--) {
      const digit = Number(base48[i]);
      sum += digit * weights[weightIndex];
      weightIndex = (weightIndex + 1) % weights.length;
    }

    const remainder = sum % 11;
    if (remainder === 0) {
      return 0;
    }
    if (remainder === 1) {
      return 1;
    }
    return 11 - remainder;
  }

  normalizeFechaToDdmmaaaa(fechaInput: string): string {
    const clean = fechaInput.trim();
    // Case 1: dd/mm/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
      return clean.replace(/\//g, '');
    }
    // Case 2: yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const [yyyy, mm, dd] = clean.split('-');
      return `${dd}${mm}${yyyy}`;
    }
    // Case 3: ddmmaaaa
    if (/^\d{8}$/.test(clean)) {
      return clean;
    }
    throw new BadRequestException(
      `INVALID_DATE_FORMAT: Formato de fecha inválido "${fechaInput}". Use "dd/mm/yyyy" o "yyyy-mm-dd".`,
    );
  }
}

