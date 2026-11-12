import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { DiagnosticErrorCode } from '../diagnostics/constants/diagnostic-error-codes';
import {
  DiagnosticIssueDto,
  EnvironmentConnectivityDto,
} from '../diagnostics/dto/diagnostic-response.dto';

export interface SriMessage {
  identificador: string;
  mensaje: string;
  informacionAdicional?: string;
  tipo: string;
}

export interface SriRecepcionResult {
  estado: 'RECIBIDA' | 'DEVUELTA' | string;
  mensajes: SriMessage[];
  rawXml: string;
}

export interface SriAutorizacionResult {
  estado: 'AUTORIZADO' | 'NO AUTORIZADO' | 'EN PROCESO' | string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
  comprobanteXml?: string;
  authorizedXml?: string;
  mensajes: SriMessage[];
  rawXml: string;
}

@Injectable()
export class SriSoapClientService {
  private readonly logger = new Logger(SriSoapClientService.name);

  private readonly endpoints = {
    '1': {
      recepcion:
        process.env.SRI_TEST_RECEPCION_URL ||
        'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
      autorizacion:
        process.env.SRI_TEST_AUTORIZACION_URL ||
        'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
    },
    '2': {
      recepcion:
        process.env.SRI_PROD_RECEPCION_URL ||
        'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
      autorizacion:
        process.env.SRI_PROD_AUTORIZACION_URL ||
        'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
    },
  };

  /**
   * Sends the signed XML (encoded in Base64) to SRI RecepcionComprobantesOffline (`validarComprobante`).
   */
  async validarComprobante(
    signedXml: string,
    ambiente: '1' | '2' | string,
  ): Promise<SriRecepcionResult> {
    const envKey = ambiente === '2' ? '2' : '1';
    const url = this.endpoints[envKey].recepcion;
    const xmlBase64 = Buffer.from(signedXml, 'utf8').toString('base64');
    const soapEnvelope = this.buildRecepcionEnvelope(xmlBase64);

    this.logger.debug(`Sending SOAP validarComprobante to ${url}`);

    const response = await axios.post<string>(url, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      timeout: 25000,
      responseType: 'text',
    });

    return this.parseRecepcionResponse(response.data);
  }

  /**
   * Queries SRI AutorizacionComprobantesOffline (`autorizacionComprobante`) by 49-digit Clave de Acceso.
   */
  async autorizacionComprobante(
    claveAcceso: string,
    ambiente: '1' | '2' | string,
  ): Promise<SriAutorizacionResult> {
    const envKey = ambiente === '2' ? '2' : '1';
    const url = this.endpoints[envKey].autorizacion;
    const soapEnvelope = this.buildAutorizacionEnvelope(claveAcceso);

    this.logger.debug(`Sending SOAP autorizacionComprobante (${claveAcceso}) to ${url}`);

    const response = await axios.post<string>(url, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      timeout: 25000,
      responseType: 'text',
    });

    return this.parseAutorizacionResponse(response.data);
  }

  /**
   * Healthcheck ping to test reachability and latency of SRI SOAP Web Services.
   * Performs an HTTP GET to the ?wsdl endpoint with strict 3500ms timeout.
   */
  async checkConnectivity(ambiente: '1' | '2' | string): Promise<EnvironmentConnectivityDto> {
    const envKey = ambiente === '2' ? '2' : '1';
    const baseUrl = this.endpoints[envKey].recepcion;
    const wsdlUrl = `${baseUrl}?wsdl`;
    const issues: DiagnosticIssueDto[] = [];
    const startTime = Date.now();

    try {
      this.logger.debug(`Checking SRI connectivity to ${wsdlUrl}`);
      const response = await axios.get(wsdlUrl, {
        timeout: 3500,
        headers: {
          Accept: 'text/xml, text/html, application/xhtml+xml',
        },
        validateStatus: () => true, // Don't throw on 4xx/5xx, inspect response status
      });

      const latencyMs = Date.now() - startTime;
      const isReachable = response.status >= 200 && response.status < 500;

      if (!isReachable) {
        issues.push({
          code: DiagnosticErrorCode.SRI_SOAP_UNREACHABLE,
          message: `El servidor del SRI respondió con estado HTTP ${response.status}.`,
          severity: 'WARNING',
          recommendedAction:
            'Verifique si el portal o servicios del SRI se encuentran en mantenimiento.',
        });
      }

      return {
        isReachable,
        latencyMs,
        url: wsdlUrl,
        details: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
        issues,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = error.code === 'ECONNABORTED' || String(error.message).includes('timeout');

      issues.push({
        code: isTimeout
          ? DiagnosticErrorCode.SRI_SOAP_TIMEOUT
          : DiagnosticErrorCode.SRI_SOAP_UNREACHABLE,
        message: isTimeout
          ? `Tiempo de espera agotado al conectar con el SRI (${wsdlUrl}) tras ${latencyMs}ms.`
          : `No se pudo establecer conexión con el SRI (${wsdlUrl}): ${error.message || 'Error de red'}`,
        severity: 'WARNING',
        recommendedAction:
          'Espere unos minutos y reintente; el SRI puede estar experimentando alta concurrencia o intermitencias.',
      });

      return {
        isReachable: false,
        latencyMs,
        url: wsdlUrl,
        details: error.message || 'Network Error',
        issues,
      };
    }
  }

  buildRecepcionEnvelope(xmlBase64: string): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">',
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      '    <ec:validarComprobante>',
      `      <xml>${xmlBase64}</xml>`,
      '    </ec:validarComprobante>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n');
  }

  buildAutorizacionEnvelope(claveAcceso: string): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">',
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      '    <ec:autorizacionComprobante>',
      `      <claveAccesoComprobante>${this.escapeXml(claveAcceso)}</claveAccesoComprobante>`,
      '    </ec:autorizacionComprobante>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n');
  }

  parseRecepcionResponse(soapXml: string): SriRecepcionResult {
    const doc = new DOMParser().parseFromString(soapXml, 'text/xml');
    const estado = this.extractNodeText(doc, '//*[local-name()="estado"]') || 'DEVUELTA';
    const mensajes = this.extractMessages(doc);

    return {
      estado,
      mensajes,
      rawXml: soapXml,
    };
  }

  parseAutorizacionResponse(soapXml: string): SriAutorizacionResult {
    const doc = new DOMParser().parseFromString(soapXml, 'text/xml');
    const autorizacionNodes = xpath.select('//*[local-name()="autorizacion"]', doc) as Node[];

    if (!autorizacionNodes || autorizacionNodes.length === 0) {
      return {
        estado: 'EN PROCESO',
        mensajes: [],
        rawXml: soapXml,
      };
    }

    const firstAuth = autorizacionNodes[0];
    const estado = this.extractNodeText(firstAuth, './*[local-name()="estado"]') || 'EN PROCESO';
    const numeroAutorizacion =
      this.extractNodeText(firstAuth, './*[local-name()="numeroAutorizacion"]') || undefined;
    const fechaAutorizacion =
      this.extractNodeText(firstAuth, './*[local-name()="fechaAutorizacion"]') || undefined;
    const ambiente = this.extractNodeText(firstAuth, './*[local-name()="ambiente"]') || undefined;
    const comprobanteXml =
      this.extractNodeText(firstAuth, './*[local-name()="comprobante"]') || undefined;
    const mensajes = this.extractMessages(firstAuth);

    const authorizedXml =
      estado === 'AUTORIZADO' && comprobanteXml
        ? this.buildAuthorizedDocumentXml({
            estado,
            numeroAutorizacion: numeroAutorizacion || '',
            fechaAutorizacion: fechaAutorizacion || new Date().toISOString(),
            ambiente: ambiente || 'PRUEBAS',
            comprobanteXml,
          })
        : undefined;

    return {
      estado,
      numeroAutorizacion,
      fechaAutorizacion,
      ambiente,
      comprobanteXml,
      authorizedXml,
      mensajes,
      rawXml: soapXml,
    };
  }

  private buildAuthorizedDocumentXml(params: {
    estado: string;
    numeroAutorizacion: string;
    fechaAutorizacion: string;
    ambiente: string;
    comprobanteXml: string;
  }): string {
    const safeCdata = params.comprobanteXml.replace(/]]>/g, ']]]]><![CDATA[>');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<autorizacion>',
      `  <estado>${this.escapeXml(params.estado)}</estado>`,
      `  <numeroAutorizacion>${this.escapeXml(params.numeroAutorizacion)}</numeroAutorizacion>`,
      `  <fechaAutorizacion>${this.escapeXml(params.fechaAutorizacion)}</fechaAutorizacion>`,
      `  <ambiente>${this.escapeXml(params.ambiente)}</ambiente>`,
      `  <comprobante><![CDATA[${safeCdata}]]></comprobante>`,
      '  <mensajes/>',
      '</autorizacion>',
    ].join('\n');
  }

  private escapeXml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private extractMessages(contextNode: Node): SriMessage[] {
    const msgNodes = xpath.select('.//*[local-name()="mensaje"]', contextNode) as Node[];
    const results: SriMessage[] = [];

    for (const node of msgNodes) {
      // Only process <mensaje> elements that are parent containers (having an <identificador> child)
      const identificador = this.extractNodeText(node, './*[local-name()="identificador"]');
      if (!identificador) {
        continue;
      }
      const mensajeText = this.extractNodeText(node, './*[local-name()="mensaje"]') || '';
      const informacionAdicional =
        this.extractNodeText(node, './*[local-name()="informacionAdicional"]') || undefined;
      const tipo = this.extractNodeText(node, './*[local-name()="tipo"]') || 'INFO';

      results.push({
        identificador,
        mensaje: mensajeText,
        informacionAdicional,
        tipo,
      });
    }

    return results;
  }

  private extractNodeText(contextNode: Node, expression: string): string | null {
    const nodes = xpath.select(expression, contextNode) as Node[];
    if (!nodes || nodes.length === 0) {
      return null;
    }
    const text = nodes[0].textContent;
    return text ? text.trim() : null;
  }
}
