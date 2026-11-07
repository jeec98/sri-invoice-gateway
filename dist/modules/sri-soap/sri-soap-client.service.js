"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var SriSoapClientService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SriSoapClientService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const xmldom_1 = require("@xmldom/xmldom");
const xpath = __importStar(require("xpath"));
let SriSoapClientService = SriSoapClientService_1 = class SriSoapClientService {
    logger = new common_1.Logger(SriSoapClientService_1.name);
    endpoints = {
        '1': {
            recepcion: process.env.SRI_TEST_RECEPCION_URL ||
                'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
            autorizacion: process.env.SRI_TEST_AUTORIZACION_URL ||
                'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
        },
        '2': {
            recepcion: process.env.SRI_PROD_RECEPCION_URL ||
                'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
            autorizacion: process.env.SRI_PROD_AUTORIZACION_URL ||
                'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
        },
    };
    async validarComprobante(signedXml, ambiente) {
        const envKey = ambiente === '2' ? '2' : '1';
        const url = this.endpoints[envKey].recepcion;
        const xmlBase64 = Buffer.from(signedXml, 'utf8').toString('base64');
        const soapEnvelope = this.buildRecepcionEnvelope(xmlBase64);
        this.logger.debug(`Sending SOAP validarComprobante to ${url}`);
        const response = await axios_1.default.post(url, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: '',
            },
            timeout: 25000,
            responseType: 'text',
        });
        return this.parseRecepcionResponse(response.data);
    }
    async autorizacionComprobante(claveAcceso, ambiente) {
        const envKey = ambiente === '2' ? '2' : '1';
        const url = this.endpoints[envKey].autorizacion;
        const soapEnvelope = this.buildAutorizacionEnvelope(claveAcceso);
        this.logger.debug(`Sending SOAP autorizacionComprobante (${claveAcceso}) to ${url}`);
        const response = await axios_1.default.post(url, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: '',
            },
            timeout: 25000,
            responseType: 'text',
        });
        return this.parseAutorizacionResponse(response.data);
    }
    buildRecepcionEnvelope(xmlBase64) {
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
    buildAutorizacionEnvelope(claveAcceso) {
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
    parseRecepcionResponse(soapXml) {
        const doc = new xmldom_1.DOMParser().parseFromString(soapXml, 'text/xml');
        const estado = this.extractNodeText(doc, '//*[local-name()="estado"]') || 'DEVUELTA';
        const mensajes = this.extractMessages(doc);
        return {
            estado,
            mensajes,
            rawXml: soapXml,
        };
    }
    parseAutorizacionResponse(soapXml) {
        const doc = new xmldom_1.DOMParser().parseFromString(soapXml, 'text/xml');
        const autorizacionNodes = xpath.select('//*[local-name()="autorizacion"]', doc);
        if (!autorizacionNodes || autorizacionNodes.length === 0) {
            return {
                estado: 'EN PROCESO',
                mensajes: [],
                rawXml: soapXml,
            };
        }
        const firstAuth = autorizacionNodes[0];
        const estado = this.extractNodeText(firstAuth, './*[local-name()="estado"]') || 'EN PROCESO';
        const numeroAutorizacion = this.extractNodeText(firstAuth, './*[local-name()="numeroAutorizacion"]') || undefined;
        const fechaAutorizacion = this.extractNodeText(firstAuth, './*[local-name()="fechaAutorizacion"]') || undefined;
        const ambiente = this.extractNodeText(firstAuth, './*[local-name()="ambiente"]') || undefined;
        const comprobanteXml = this.extractNodeText(firstAuth, './*[local-name()="comprobante"]') || undefined;
        const mensajes = this.extractMessages(firstAuth);
        const authorizedXml = estado === 'AUTORIZADO' && comprobanteXml
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
    buildAuthorizedDocumentXml(params) {
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
    escapeXml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    extractMessages(contextNode) {
        const msgNodes = xpath.select('.//*[local-name()="mensaje"]', contextNode);
        const results = [];
        for (const node of msgNodes) {
            const identificador = this.extractNodeText(node, './*[local-name()="identificador"]');
            if (!identificador) {
                continue;
            }
            const mensajeText = this.extractNodeText(node, './*[local-name()="mensaje"]') || '';
            const informacionAdicional = this.extractNodeText(node, './*[local-name()="informacionAdicional"]') || undefined;
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
    extractNodeText(contextNode, expression) {
        const nodes = xpath.select(expression, contextNode);
        if (!nodes || nodes.length === 0) {
            return null;
        }
        const text = nodes[0].textContent;
        return text ? text.trim() : null;
    }
};
exports.SriSoapClientService = SriSoapClientService;
exports.SriSoapClientService = SriSoapClientService = SriSoapClientService_1 = __decorate([
    (0, common_1.Injectable)()
], SriSoapClientService);
//# sourceMappingURL=sri-soap-client.service.js.map