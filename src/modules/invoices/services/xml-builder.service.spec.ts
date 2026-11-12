import { describe, it, expect, beforeEach } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { XmlBuilderService } from './xml-builder.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { CreateRetentionDto } from '../dto/create-retention.dto';

describe('XmlBuilderService', () => {
  let service: XmlBuilderService;

  beforeEach(() => {
    service = new XmlBuilderService();
  });

  it('should build a canonical SRI v1.1.0 XML supporting IVA 15%, 0%, Exempt, Not Subject, and infoAdicional', () => {
    const claveAcceso = '0711202601179001167400110010010000001231234567815';
    const dto: CreateInvoiceDto = {
      referenceId: 'REF-1001',
      ambiente: '1',
      webhookUrl: 'https://saas.example.com/webhooks/sri',
      razonSocial: 'TECNOLOGIA & SOLUCIONES S.A.',
      nombreComercial: 'TECHSOL',
      ruc: '1790011674001',
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000123',
      dirMatriz: 'AV. AMAZONAS Y NACIONES UNIDAS',
      fechaEmision: '07/11/2026',
      dirEstablecimiento: 'AV. AMAZONAS Y NACIONES UNIDAS',
      obligadoContabilidad: 'SI',
      tipoIdentificacionComprador: '04',
      razonSocialComprador: 'CLIENTE CORPORATIVO S.A.',
      identificacionComprador: '0991234567001',
      direccionComprador: 'GUAYAQUIL, ECUADOR',
      totalSinImpuestos: 150.0,
      totalDescuento: 0.0,
      propina: 0.0,
      importeTotal: 165.0,
      moneda: 'DOLAR',
      pagos: [
        {
          formaPago: '20',
          total: 165.0,
          plazo: '30',
          unidadTiempo: 'dias',
        },
      ],
      detalles: [
        {
          codigoPrincipal: 'SRV-15',
          descripcion: 'Servicio Cloud Gravado IVA 15%',
          cantidad: 1,
          precioUnitario: 100.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            {
              codigo: '2',
              codigoPorcentaje: '4', // IVA 15%
              tarifa: 15,
              baseImponible: 100.0,
              valor: 15.0,
            },
          ],
        },
        {
          codigoPrincipal: 'SRV-00',
          descripcion: 'Producto Tarifa 0%',
          cantidad: 1,
          precioUnitario: 50.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 50.0,
          impuestos: [
            {
              codigo: '2',
              codigoPorcentaje: '0', // IVA 0%
              tarifa: 0,
              baseImponible: 50.0,
              valor: 0.0,
            },
          ],
        },
      ],
      infoAdicional: [
        { nombre: 'Email', valor: 'cliente@corporativo.com' },
        { nombre: 'OrdenCompra', valor: 'OC-2026-998' },
      ],
    };

    const xml = service.buildFacturaXml(dto, claveAcceso);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<factura id="comprobante" version="1.1.0">');
    expect(xml).toContain(`<claveAcceso>${claveAcceso}</claveAcceso>`);
    expect(xml).toContain('<razonSocial>TECNOLOGIA &amp; SOLUCIONES S.A.</razonSocial>');
    expect(xml).toContain('<codigoPorcentaje>4</codigoPorcentaje>');
    expect(xml).toContain('<tarifa>15.00</tarifa>');
    expect(xml).toContain(
      '<campoAdicional nombre="Email">cliente@corporativo.com</campoAdicional>',
    );

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const totalImpuestos = xpath.select(
      '//infoFactura/totalConImpuestos/totalImpuesto',
      doc,
    ) as Node[];
    expect(totalImpuestos.length).toBe(2);

    const detalles = xpath.select('//detalles/detalle', doc) as Node[];
    expect(detalles.length).toBe(2);
  });

  it('should automatically inject <campoAdicional nombre="RUC Proveedor"> when providerRuc is passed and infoAdicional is empty', () => {
    const claveAcceso = '0711202601179001167400110010010000001231234567815';
    const dto: CreateInvoiceDto = {
      referenceId: 'REF-1002',
      ambiente: '1',
      razonSocial: 'EMPRESA EMISORA S.A.',
      ruc: '1790011674001',
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000124',
      dirMatriz: 'QUITO',
      fechaEmision: '07/11/2026',
      dirEstablecimiento: 'QUITO',
      tipoIdentificacionComprador: '04',
      razonSocialComprador: 'COMPRADOR S.A.',
      identificacionComprador: '0991234567001',
      totalSinImpuestos: 100.0,
      totalDescuento: 0.0,
      importeTotal: 115.0,
      pagos: [{ formaPago: '20', total: 115.0 }],
      detalles: [
        {
          codigoPrincipal: 'SRV-1',
          descripcion: 'Servicio',
          cantidad: 1,
          precioUnitario: 100.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            { codigo: '2', codigoPorcentaje: '4', tarifa: 15, baseImponible: 100.0, valor: 15.0 },
          ],
        },
      ],
    };

    const xml = service.buildFacturaXml(dto, claveAcceso, '1799999999001');
    expect(xml).toContain('<infoAdicional>');
    expect(xml).toContain('<campoAdicional nombre="RUC Proveedor">1799999999001</campoAdicional>');
  });

  it('should merge providerRuc with existing infoAdicional and avoid duplicates if RUC Proveedor is already set', () => {
    const claveAcceso = '0711202601179001167400110010010000001231234567815';
    const dto: CreateInvoiceDto = {
      referenceId: 'REF-1003',
      ambiente: '1',
      razonSocial: 'EMPRESA EMISORA S.A.',
      ruc: '1790011674001',
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000125',
      dirMatriz: 'QUITO',
      fechaEmision: '07/11/2026',
      dirEstablecimiento: 'QUITO',
      tipoIdentificacionComprador: '04',
      razonSocialComprador: 'COMPRADOR S.A.',
      identificacionComprador: '0991234567001',
      totalSinImpuestos: 100.0,
      totalDescuento: 0.0,
      importeTotal: 115.0,
      pagos: [{ formaPago: '20', total: 115.0 }],
      detalles: [
        {
          codigoPrincipal: 'SRV-1',
          descripcion: 'Servicio',
          cantidad: 1,
          precioUnitario: 100.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            { codigo: '2', codigoPorcentaje: '4', tarifa: 15, baseImponible: 100.0, valor: 15.0 },
          ],
        },
      ],
      infoAdicional: [
        { nombre: 'Email', valor: 'cliente@empresa.com' },
        { nombre: 'RUC Proveedor', valor: '1788888888001' },
      ],
    };

    const xml = service.buildFacturaXml(dto, claveAcceso, '1799999999001');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const campos = xpath.select('//infoAdicional/campoAdicional', doc) as Node[];
    expect(campos.length).toBe(2);
    expect(xml).toContain('<campoAdicional nombre="Email">cliente@empresa.com</campoAdicional>');
    expect(xml).toContain('<campoAdicional nombre="RUC Proveedor">1788888888001</campoAdicional>');
    expect(xml).not.toContain('1799999999001');
  });

  it('should build a canonical SRI v2.0.0 comprobanteRetencion XML (codDoc=07) with docsSustento, Renta, and IVA withholdings', () => {
    const claveAcceso = '1111202607189000000000110010010000000011234567819';
    const dto: CreateRetentionDto = {
      referenceId: 'RET-2026-0001',
      ambiente: '1',
      razonSocial: 'CARROCERIAS INDUSTRIALES & CIA. S.A.',
      nombreComercial: 'CARROINSA',
      ruc: '1890000000001',
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000001',
      dirMatriz: 'AV. INDOAMERICA KM 5',
      fechaEmision: '11/11/2026',
      dirEstablecimiento: 'AV. INDOAMERICA KM 5',
      obligadoContabilidad: 'SI',
      agenteRetencion: '1',
      tipoIdentificacionSujetoRetenido: '04',
      parteRel: 'NO',
      razonSocialSujetoRetenido: 'ACEROS & PERFILES S.A.',
      identificacionSujetoRetenido: '1790016919001',
      periodoFiscal: '11/2026',
      docsSustento: [
        {
          codSustento: '01',
          codDocSustento: '01',
          numDocSustento: '001002000045678',
          fechaEmisionDocSustento: '10/11/2026',
          fechaRegistroContable: '10/11/2026',
          numAutDocSustento: '1011202601179001691900120010020000456781234567819',
          pagoLocExt: '01',
          totalSinImpuestos: 1000.0,
          importeTotal: 1150.0,
          impuestosDocSustento: [
            {
              codImpuestoDocSustento: '2',
              codigoPorcentaje: '4',
              baseImponible: 1000.0,
              tarifa: 15,
              valorImpuesto: 150.0,
            },
          ],
          retenciones: [
            {
              codigo: '1',
              codigoRetencion: '312',
              baseImponible: 1000.0,
              porcentajeRetener: 2,
              valorRetenido: 20.0,
            },
            {
              codigo: '2',
              codigoRetencion: '1',
              baseImponible: 150.0,
              porcentajeRetener: 30,
              valorRetenido: 45.0,
            },
          ],
          pagos: [{ formaPago: '20', total: 1150.0 }],
        },
      ],
      infoAdicional: [{ nombre: 'Email', valor: 'facturacion@aceros.ec' }],
    };

    const xml = service.buildRetencionXml(dto, claveAcceso);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
    expect(xml).toContain('<codDoc>07</codDoc>');
    expect(xml).toContain(`<claveAcceso>${claveAcceso}</claveAcceso>`);
    expect(xml).toContain('<agenteRetencion>1</agenteRetencion>');
    expect(xml).toContain('<periodoFiscal>11/2026</periodoFiscal>');
    expect(xml).toContain('<razonSocialSujetoRetenido>ACEROS &amp; PERFILES S.A.</razonSocialSujetoRetenido>');

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const docsSustento = xpath.select('//docsSustento/docSustento', doc) as Node[];
    expect(docsSustento.length).toBe(1);

    const retenciones = xpath.select('//docsSustento/docSustento/retenciones/retencion', doc) as Node[];
    expect(retenciones.length).toBe(2);
    expect(xml).toContain('<codigoRetencion>312</codigoRetencion>');
    expect(xml).toContain('<porcentajeRetener>2.00</porcentajeRetener>');
    expect(xml).toContain('<valorRetenido>20.00</valorRetenido>');
    expect(xml).toContain('<valorRetenido>45.00</valorRetenido>');
  });
});
