import { describe, it, expect, beforeEach } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { XmlBuilderService } from './xml-builder.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';

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
});
