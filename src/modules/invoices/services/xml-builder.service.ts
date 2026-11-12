import { Injectable } from '@nestjs/common';
import { CreateInvoiceDto, InvoiceTaxItemDto } from '../dto/create-invoice.dto';
import { CreateRetentionDto } from '../dto/create-retention.dto';

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
  buildFacturaXml(dto: CreateInvoiceDto, claveAcceso: string, providerRuc?: string | null): string {
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
    this.appendInfoTributariaLines(lines, {
      ambiente: dto.ambiente,
      razonSocial: dto.razonSocial,
      nombreComercial: dto.nombreComercial,
      ruc: dto.ruc,
      claveAcceso,
      codDoc: '01',
      estab,
      ptoEmi,
      secuencial,
      dirMatriz: dto.dirMatriz,
    });

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
    const infoAdicional = [...(dto.infoAdicional ?? [])];
    const cleanProviderRuc = providerRuc?.trim();
    if (cleanProviderRuc) {
      const hasRucProveedor = infoAdicional.some(
        (campo) => campo.nombre.trim().toLowerCase() === 'ruc proveedor',
      );
      if (!hasRucProveedor) {
        infoAdicional.push({
          nombre: 'RUC Proveedor',
          valor: cleanProviderRuc,
        });
      }
    }

        this.appendInfoAdicionalLines(lines, infoAdicional);

        lines.push('</factura>');
        return lines.join('\n');
      }

      /**
       * Builds the canonical UTF-8 XML for Ecuadorian SRI Electronic Withholding Receipt
       * `<comprobanteRetencion id="comprobante" version="2.0.0">` (`codDoc = '07'`).
       */
      buildRetencionXml(dto: CreateRetentionDto, claveAcceso: string): string {
        const estab = dto.estab.trim().padStart(3, '0');
        const ptoEmi = dto.ptoEmi.trim().padStart(3, '0');
        const secuencial = dto.secuencial.trim().padStart(9, '0');
        const fechaEmision = this.normalizeFechaToDdMmYyyySlash(dto.fechaEmision);
        const obligadoContabilidad = dto.obligadoContabilidad || 'SI';

        const lines: string[] = [];
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');
        lines.push('<comprobanteRetencion id="comprobante" version="2.0.0">');

        // 1. <infoTributaria>
        this.appendInfoTributariaLines(lines, {
          ambiente: dto.ambiente,
          razonSocial: dto.razonSocial,
          nombreComercial: dto.nombreComercial,
          ruc: dto.ruc,
          claveAcceso,
          codDoc: '07',
          estab,
          ptoEmi,
          secuencial,
          dirMatriz: dto.dirMatriz,
          agenteRetencion: dto.agenteRetencion,
          contribuyenteRimpe: dto.contribuyenteRimpe,
        });

        // 2. <infoCompRetencion>
        lines.push('  <infoCompRetencion>');
        lines.push(`    <fechaEmision>${this.escapeXml(fechaEmision)}</fechaEmision>`);
        lines.push(
          `    <dirEstablecimiento>${this.escapeXml(dto.dirEstablecimiento)}</dirEstablecimiento>`,
        );
        if (dto.contribuyenteEspecial) {
          lines.push(
            `    <contribuyenteEspecial>${this.escapeXml(dto.contribuyenteEspecial)}</contribuyenteEspecial>`,
          );
        }
        lines.push(
          `    <obligadoContabilidad>${this.escapeXml(obligadoContabilidad)}</obligadoContabilidad>`,
        );
        lines.push(
          `    <tipoIdentificacionSujetoRetenido>${this.escapeXml(dto.tipoIdentificacionSujetoRetenido)}</tipoIdentificacionSujetoRetenido>`,
        );
        lines.push(`    <parteRel>${this.escapeXml(dto.parteRel || 'NO')}</parteRel>`);
        lines.push(
          `    <razonSocialSujetoRetenido>${this.escapeXml(dto.razonSocialSujetoRetenido)}</razonSocialSujetoRetenido>`,
        );
        lines.push(
          `    <identificacionSujetoRetenido>${this.escapeXml(dto.identificacionSujetoRetenido)}</identificacionSujetoRetenido>`,
        );
        lines.push(`    <periodoFiscal>${this.escapeXml(dto.periodoFiscal)}</periodoFiscal>`);
        lines.push('  </infoCompRetencion>');

        // 3. <docsSustento>
        lines.push('  <docsSustento>');
        for (const doc of dto.docsSustento) {
          const fechaDoc = this.normalizeFechaToDdMmYyyySlash(doc.fechaEmisionDocSustento);
          const fechaCont = this.normalizeFechaToDdMmYyyySlash(
            doc.fechaRegistroContable || doc.fechaEmisionDocSustento,
          );
          const numDocClean = doc.numDocSustento.replaceAll('-', '').trim().padStart(15, '0');

          lines.push('    <docSustento>');
          lines.push(`      <codSustento>${this.escapeXml(doc.codSustento || '01')}</codSustento>`);
          lines.push(
            `      <codDocSustento>${this.escapeXml(doc.codDocSustento || '01')}</codDocSustento>`,
          );
          lines.push(`      <numDocSustento>${this.escapeXml(numDocClean)}</numDocSustento>`);
          lines.push(
            `      <fechaEmisionDocSustento>${this.escapeXml(fechaDoc)}</fechaEmisionDocSustento>`,
          );
          lines.push(
            `      <fechaRegistroContable>${this.escapeXml(fechaCont)}</fechaRegistroContable>`,
          );
          if (doc.numAutDocSustento) {
            lines.push(
              `      <numAutDocSustento>${this.escapeXml(doc.numAutDocSustento)}</numAutDocSustento>`,
            );
          }
          lines.push(`      <pagoLocExt>${this.escapeXml(doc.pagoLocExt || '01')}</pagoLocExt>`);
          lines.push(
            `      <totalSinImpuestos>${this.formatAmount(doc.totalSinImpuestos)}</totalSinImpuestos>`,
          );
          lines.push(`      <importeTotal>${this.formatAmount(doc.importeTotal)}</importeTotal>`);

          lines.push('      <impuestosDocSustento>');
          for (const imp of doc.impuestosDocSustento) {
            lines.push('        <impuestoDocSustento>');
            lines.push(
              `          <codImpuestoDocSustento>${this.escapeXml(imp.codImpuestoDocSustento)}</codImpuestoDocSustento>`,
            );
            lines.push(
              `          <codigoPorcentaje>${this.escapeXml(imp.codigoPorcentaje)}</codigoPorcentaje>`,
            );
            lines.push(
              `          <baseImponible>${this.formatAmount(imp.baseImponible)}</baseImponible>`,
            );
            lines.push(`          <tarifa>${this.formatAmount(imp.tarifa)}</tarifa>`);
            lines.push(
              `          <valorImpuesto>${this.formatAmount(imp.valorImpuesto)}</valorImpuesto>`,
            );
            lines.push('        </impuestoDocSustento>');
          }
          lines.push('      </impuestosDocSustento>');

          lines.push('      <retenciones>');
          for (const ret of doc.retenciones) {
            lines.push('        <retencion>');
            lines.push(`          <codigo>${this.escapeXml(ret.codigo)}</codigo>`);
            lines.push(
              `          <codigoRetencion>${this.escapeXml(ret.codigoRetencion)}</codigoRetencion>`,
            );
            lines.push(
              `          <baseImponible>${this.formatAmount(ret.baseImponible)}</baseImponible>`,
            );
            lines.push(
              `          <porcentajeRetener>${this.formatAmount(ret.porcentajeRetener)}</porcentajeRetener>`,
            );
            lines.push(
              `          <valorRetenido>${this.formatAmount(ret.valorRetenido)}</valorRetenido>`,
            );
            lines.push('        </retencion>');
          }
          lines.push('      </retenciones>');

          lines.push('      <pagos>');
          for (const pago of doc.pagos) {
            lines.push('        <pago>');
            lines.push(`          <formaPago>${this.escapeXml(pago.formaPago)}</formaPago>`);
            lines.push(`          <total>${this.formatAmount(pago.total)}</total>`);
            lines.push('        </pago>');
          }
          lines.push('      </pagos>');
          lines.push('    </docSustento>');
        }
        lines.push('  </docsSustento>');

        // 4. <infoAdicional>
        this.appendInfoAdicionalLines(lines, dto.infoAdicional ?? []);

        lines.push('</comprobanteRetencion>');
        return lines.join('\n');
      }

  private appendInfoTributariaLines(
        lines: string[],
        params: {
          ambiente: string;
          razonSocial: string;
          nombreComercial?: string;
          ruc: string;
          claveAcceso: string;
          codDoc: '01' | '07';
          estab: string;
          ptoEmi: string;
          secuencial: string;
          dirMatriz: string;
          agenteRetencion?: string;
          contribuyenteRimpe?: string;
        },
      ): void {
    lines.push('  <infoTributaria>');
    lines.push(`    <ambiente>${this.escapeXml(params.ambiente)}</ambiente>`);
    lines.push('    <tipoEmision>1</tipoEmision>');
    lines.push(`    <razonSocial>${this.escapeXml(params.razonSocial)}</razonSocial>`);
    if (params.nombreComercial) {
      lines.push(
        `    <nombreComercial>${this.escapeXml(params.nombreComercial)}</nombreComercial>`,
      );
    }
    lines.push(`    <ruc>${this.escapeXml(params.ruc)}</ruc>`);
    lines.push(`    <claveAcceso>${this.escapeXml(params.claveAcceso)}</claveAcceso>`);
    lines.push(`    <codDoc>${params.codDoc}</codDoc>`);
    lines.push(`    <estab>${this.escapeXml(params.estab)}</estab>`);
    lines.push(`    <ptoEmi>${this.escapeXml(params.ptoEmi)}</ptoEmi>`);
    lines.push(`    <secuencial>${this.escapeXml(params.secuencial)}</secuencial>`);
    lines.push(`    <dirMatriz>${this.escapeXml(params.dirMatriz)}</dirMatriz>`);
    if (params.agenteRetencion) {
      lines.push(
        `    <agenteRetencion>${this.escapeXml(params.agenteRetencion)}</agenteRetencion>`,
      );
    }
    if (params.contribuyenteRimpe) {
      lines.push(
        `    <contribuyenteRimpe>${this.escapeXml(params.contribuyenteRimpe)}</contribuyenteRimpe>`,
      );
    }
    lines.push('  </infoTributaria>');
  }

  private appendInfoAdicionalLines(
    lines: string[],
    infoAdicional: Array<{ nombre: string; valor: string }>,
  ): void {
    if (infoAdicional.length === 0) return;
    lines.push('  <infoAdicional>');
    for (const campo of infoAdicional) {
      lines.push(
        `    <campoAdicional nombre="${this.escapeXml(campo.nombre)}">${this.escapeXml(campo.valor)}</campoAdicional>`,
      );
    }
    lines.push('  </infoAdicional>');
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
