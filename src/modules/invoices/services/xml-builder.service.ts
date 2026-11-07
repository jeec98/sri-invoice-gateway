import { Injectable } from '@nestjs/common';
import { CreateInvoiceDto, InvoiceTaxItemDto } from '../dto/create-invoice.dto';

interface GroupedTotalImpuesto {
  codigo: string;
  codigoPorcentaje: string;
  baseImponible: number;
  valor: number;
}

@Injectable()
export class XmlBuilderService {
  /**
   * Builds the canonical UTF-8 XML for Ecuadorian SRI Electronic Invoice
   * `<factura id="comprobante" version="1.1.0">`.
   */
  buildFacturaXml(dto: CreateInvoiceDto, claveAcceso: string): string {
    const estab = dto.estab.trim().padStart(3, '0');
    const ptoEmi = dto.ptoEmi.trim().padStart(3, '0');
    const secuencial = dto.secuencial.trim().padStart(9, '0');
    const fechaEmision = this.normalizeFechaToDdMmYyyySlash(dto.fechaEmision);
    const moneda = dto.moneda || 'DOLAR';
    const propina = dto.propina ?? 0;
    const obligadoContabilidad = dto.obligadoContabilidad || 'SI';

    // Aggregate <totalConImpuestos> by (codigo + codigoPorcentaje)
    const groupedTaxes = this.aggregateTaxes(dto.detalles.flatMap((d) => d.impuestos));

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<factura id="comprobante" version="1.1.0">');

    // 1. <infoTributaria>
    lines.push('  <infoTributaria>');
    lines.push(`    <ambiente>${this.escapeXml(dto.ambiente)}</ambiente>`);
    lines.push('    <tipoEmision>1</tipoEmision>');
    lines.push(`    <razonSocial>${this.escapeXml(dto.razonSocial)}</razonSocial>`);
    if (dto.nombreComercial) {
      lines.push(`    <nombreComercial>${this.escapeXml(dto.nombreComercial)}</nombreComercial>`);
    }
    lines.push(`    <ruc>${this.escapeXml(dto.ruc)}</ruc>`);
    lines.push(`    <claveAcceso>${this.escapeXml(claveAcceso)}</claveAcceso>`);
    lines.push('    <codDoc>01</codDoc>');
    lines.push(`    <estab>${this.escapeXml(estab)}</estab>`);
    lines.push(`    <ptoEmi>${this.escapeXml(ptoEmi)}</ptoEmi>`);
    lines.push(`    <secuencial>${this.escapeXml(secuencial)}</secuencial>`);
    lines.push(`    <dirMatriz>${this.escapeXml(dto.dirMatriz)}</dirMatriz>`);
    lines.push('  </infoTributaria>');

    // 2. <infoFactura>
    lines.push('  <infoFactura>');
    lines.push(`    <fechaEmision>${this.escapeXml(fechaEmision)}</fechaEmision>`);
    lines.push(
      `    <dirEstablecimiento>${this.escapeXml(dto.dirEstablecimiento)}</dirEstablecimiento>`,
    );
    lines.push(
      `    <obligadoContabilidad>${this.escapeXml(obligadoContabilidad)}</obligadoContabilidad>`,
    );
    lines.push(
      `    <tipoIdentificacionComprador>${this.escapeXml(dto.tipoIdentificacionComprador)}</tipoIdentificacionComprador>`,
    );
    lines.push(
      `    <razonSocialComprador>${this.escapeXml(dto.razonSocialComprador)}</razonSocialComprador>`,
    );
    lines.push(
      `    <identificacionComprador>${this.escapeXml(dto.identificacionComprador)}</identificacionComprador>`,
    );
    if (dto.direccionComprador) {
      lines.push(
        `    <direccionComprador>${this.escapeXml(dto.direccionComprador)}</direccionComprador>`,
      );
    }
    lines.push(
      `    <totalSinImpuestos>${this.formatAmount(dto.totalSinImpuestos)}</totalSinImpuestos>`,
    );
    lines.push(`    <totalDescuento>${this.formatAmount(dto.totalDescuento)}</totalDescuento>`);

    // <totalConImpuestos>
    lines.push('    <totalConImpuestos>');
    for (const tax of groupedTaxes) {
      lines.push('      <totalImpuesto>');
      lines.push(`        <codigo>${this.escapeXml(tax.codigo)}</codigo>`);
      lines.push(
        `        <codigoPorcentaje>${this.escapeXml(tax.codigoPorcentaje)}</codigoPorcentaje>`,
      );
      lines.push(`        <baseImponible>${this.formatAmount(tax.baseImponible)}</baseImponible>`);
      lines.push(`        <valor>${this.formatAmount(tax.valor)}</valor>`);
      lines.push('      </totalImpuesto>');
    }
    lines.push('    </totalConImpuestos>');

    lines.push(`    <propina>${this.formatAmount(propina)}</propina>`);
    lines.push(`    <importeTotal>${this.formatAmount(dto.importeTotal)}</importeTotal>`);
    lines.push(`    <moneda>${this.escapeXml(moneda)}</moneda>`);

    // <pagos>
    lines.push('    <pagos>');
    for (const pago of dto.pagos) {
      lines.push('      <pago>');
      lines.push(`        <formaPago>${this.escapeXml(pago.formaPago)}</formaPago>`);
      lines.push(`        <total>${this.formatAmount(pago.total)}</total>`);
      if (pago.plazo) {
        lines.push(`        <plazo>${this.escapeXml(pago.plazo)}</plazo>`);
      }
      if (pago.unidadTiempo) {
        lines.push(`        <unidadTiempo>${this.escapeXml(pago.unidadTiempo)}</unidadTiempo>`);
      }
      lines.push('      </pago>');
    }
    lines.push('    </pagos>');
    lines.push('  </infoFactura>');

    // 3. <detalles>
    lines.push('  <detalles>');
    for (const item of dto.detalles) {
      lines.push('    <detalle>');
      lines.push(
        `      <codigoPrincipal>${this.escapeXml(item.codigoPrincipal)}</codigoPrincipal>`,
      );
      if (item.codigoAuxiliar) {
        lines.push(`      <codigoAuxiliar>${this.escapeXml(item.codigoAuxiliar)}</codigoAuxiliar>`);
      }
      lines.push(`      <descripcion>${this.escapeXml(item.descripcion)}</descripcion>`);
      lines.push(`      <cantidad>${this.formatQuantity(item.cantidad)}</cantidad>`);
      lines.push(
        `      <precioUnitario>${this.formatQuantity(item.precioUnitario)}</precioUnitario>`,
      );
      lines.push(`      <descuento>${this.formatAmount(item.descuento)}</descuento>`);
      lines.push(
        `      <precioTotalSinImpuesto>${this.formatAmount(item.precioTotalSinImpuesto)}</precioTotalSinImpuesto>`,
      );
      lines.push('      <impuestos>');
      for (const imp of item.impuestos) {
        lines.push('        <impuesto>');
        lines.push(`          <codigo>${this.escapeXml(imp.codigo)}</codigo>`);
        lines.push(
          `          <codigoPorcentaje>${this.escapeXml(imp.codigoPorcentaje)}</codigoPorcentaje>`,
        );
        lines.push(`          <tarifa>${this.formatAmount(imp.tarifa)}</tarifa>`);
        lines.push(
          `          <baseImponible>${this.formatAmount(imp.baseImponible)}</baseImponible>`,
        );
        lines.push(`          <valor>${this.formatAmount(imp.valor)}</valor>`);
        lines.push('        </impuesto>');
      }
      lines.push('      </impuestos>');
      lines.push('    </detalle>');
    }
    lines.push('  </detalles>');

    // 4. <infoAdicional>
    if (dto.infoAdicional && dto.infoAdicional.length > 0) {
      lines.push('  <infoAdicional>');
      for (const campo of dto.infoAdicional) {
        lines.push(
          `    <campoAdicional nombre="${this.escapeXml(campo.nombre)}">${this.escapeXml(campo.valor)}</campoAdicional>`,
        );
      }
      lines.push('  </infoAdicional>');
    }

    lines.push('</factura>');
    return lines.join('\n');
  }

  private aggregateTaxes(taxes: InvoiceTaxItemDto[]): GroupedTotalImpuesto[] {
    const map = new Map<string, GroupedTotalImpuesto>();

    for (const tax of taxes) {
      const key = `${tax.codigo}:${tax.codigoPorcentaje}`;
      const current = map.get(key);
      if (current) {
        current.baseImponible = Number((current.baseImponible + tax.baseImponible).toFixed(2));
        current.valor = Number((current.valor + tax.valor).toFixed(2));
      } else {
        map.set(key, {
          codigo: tax.codigo,
          codigoPorcentaje: tax.codigoPorcentaje,
          baseImponible: Number(tax.baseImponible.toFixed(2)),
          valor: Number(tax.valor.toFixed(2)),
        });
      }
    }

    return Array.from(map.values());
  }

  private normalizeFechaToDdMmYyyySlash(input: string): string {
    const clean = input.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
      return clean;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const [yyyy, mm, dd] = clean.split('-');
      return `${dd}/${mm}/${yyyy}`;
    }
    if (/^\d{8}$/.test(clean)) {
      return `${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4, 8)}`;
    }
    return clean;
  }

  private formatAmount(num: number): string {
    return Number(num).toFixed(2);
  }

  private formatQuantity(num: number): string {
    // Preserve up to 6 decimals if needed, minimum 2 decimals per SRI schema
    const fixed2 = Number(num).toFixed(2);
    if (Number(fixed2) === Number(num)) {
      return fixed2;
    }
    return Number(num).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
  }

  private escapeXml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
