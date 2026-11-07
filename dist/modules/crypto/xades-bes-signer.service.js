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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XadesBesSignerService = void 0;
const common_1 = require("@nestjs/common");
const forge = __importStar(require("node-forge"));
const crypto = __importStar(require("node:crypto"));
const xmldom_1 = require("@xmldom/xmldom");
const p12_parser_service_1 = require("./p12-parser.service");
let XadesBesSignerService = class XadesBesSignerService {
    p12Parser;
    dsNamespace = 'http://www.w3.org/2000/09/xmldsig#';
    etsiNamespace = 'http://uri.etsi.org/01903/v1.3.2#';
    constructor(p12Parser) {
        this.p12Parser = p12Parser;
    }
    signXml(unsignedXml, p12Buffer, password) {
        const p12Material = this.p12Parser.extractAndValidate(p12Buffer, password);
        const parser = new xmldom_1.DOMParser();
        const doc = parser.parseFromString(unsignedXml.trim(), 'text/xml');
        const rootElement = doc.documentElement;
        if (!rootElement || rootElement.getAttribute('id') !== 'comprobante') {
            throw new common_1.BadRequestException('INVALID_XML_ROOT: El documento XML debe tener un nodo raíz con atributo id="comprobante".');
        }
        const rnd = () => Math.floor(100000 + Math.random() * 899999);
        const signatureId = `Signature${rnd()}`;
        const signatureValueId = `SignatureValue${rnd()}`;
        const signedPropertiesId = `Signature${rnd()}-SignedProperties${rnd()}`;
        const keyInfoId = `Certificate${rnd()}`;
        const referenceComprobanteId = `Reference-ID-${rnd()}`;
        const signedPropertiesRefId = `SignedPropertiesID${rnd()}`;
        const objectId = `${signatureId}-Object${rnd()}`;
        const canonicalComprobante = this.canonicalizeElement(rootElement);
        const comprobanteDigestBase64 = this.sha1Base64(canonicalComprobante);
        const signingTime = this.formatEcuadorIsoDate(new Date());
        const signedPropertiesXml = [
            `<etsi:SignedProperties xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signedPropertiesId}">`,
            `<etsi:SignedSignatureProperties>`,
            `<etsi:SigningTime>${signingTime}</etsi:SigningTime>`,
            `<etsi:SigningCertificate>`,
            `<etsi:Cert>`,
            `<etsi:CertDigest>`,
            `<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
            `<ds:DigestValue>${p12Material.certSha1Base64}</ds:DigestValue>`,
            `</etsi:CertDigest>`,
            `<etsi:IssuerSerial>`,
            `<ds:X509IssuerName>${this.escapeXml(p12Material.issuerName)}</ds:X509IssuerName>`,
            `<ds:X509SerialNumber>${p12Material.serialNumberDec}</ds:X509SerialNumber>`,
            `</etsi:IssuerSerial>`,
            `</etsi:Cert>`,
            `</etsi:SigningCertificate>`,
            `</etsi:SignedSignatureProperties>`,
            `<etsi:SignedDataObjectProperties>`,
            `<etsi:DataObjectFormat ObjectReference="#${referenceComprobanteId}">`,
            `<etsi:Description>contenido comprobante</etsi:Description>`,
            `<etsi:MimeType>text/xml</etsi:MimeType>`,
            `</etsi:DataObjectFormat>`,
            `</etsi:SignedDataObjectProperties>`,
            `</etsi:SignedProperties>`,
        ].join('');
        const signedPropertiesDigestBase64 = this.sha1Base64(signedPropertiesXml);
        const formattedCertBase64 = this.chunkBase64(p12Material.certDerBase64);
        const formattedModulusBase64 = this.chunkBase64(p12Material.modulusBase64);
        const keyInfoXml = [
            `<ds:KeyInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${keyInfoId}">`,
            `\n<ds:X509Data>`,
            `\n<ds:X509Certificate>\n${formattedCertBase64}\n</ds:X509Certificate>`,
            `\n</ds:X509Data>`,
            `\n<ds:KeyValue>`,
            `\n<ds:RSAKeyValue>`,
            `\n<ds:Modulus>\n${formattedModulusBase64}\n</ds:Modulus>`,
            `\n<ds:Exponent>${p12Material.exponentBase64}</ds:Exponent>`,
            `\n</ds:RSAKeyValue>`,
            `\n</ds:KeyValue>`,
            `\n</ds:KeyInfo>`,
        ].join('');
        const keyInfoDigestBase64 = this.sha1Base64(keyInfoXml);
        const signedInfoXml = [
            `<ds:SignedInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}">`,
            `\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>`,
            `\n<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>`,
            `\n<ds:Reference Id="${signedPropertiesRefId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropertiesId}">`,
            `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
            `\n<ds:DigestValue>${signedPropertiesDigestBase64}</ds:DigestValue>`,
            `\n</ds:Reference>`,
            `\n<ds:Reference URI="#${keyInfoId}">`,
            `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
            `\n<ds:DigestValue>${keyInfoDigestBase64}</ds:DigestValue>`,
            `\n</ds:Reference>`,
            `\n<ds:Reference Id="${referenceComprobanteId}" URI="#comprobante">`,
            `\n<ds:Transforms>`,
            `\n<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>`,
            `\n</ds:Transforms>`,
            `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
            `\n<ds:DigestValue>${comprobanteDigestBase64}</ds:DigestValue>`,
            `\n</ds:Reference>`,
            `\n</ds:SignedInfo>`,
        ].join('');
        const md = forge.md.sha1.create();
        md.update(signedInfoXml, 'utf8');
        const rawSignatureBytes = p12Material.privateKey.sign(md);
        const signatureValueBase64 = this.chunkBase64(forge.util.encode64(rawSignatureBytes));
        const signedInfoInner = signedInfoXml.replace(`<ds:SignedInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}">`, '<ds:SignedInfo>');
        const keyInfoInner = keyInfoXml.replace(`<ds:KeyInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${keyInfoId}">`, `<ds:KeyInfo Id="${keyInfoId}">`);
        const signedPropertiesInner = signedPropertiesXml.replace(`<etsi:SignedProperties xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signedPropertiesId}">`, `<etsi:SignedProperties Id="${signedPropertiesId}">`);
        const dsSignatureBlock = [
            `<ds:Signature xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signatureId}">`,
            `\n${signedInfoInner}`,
            `\n<ds:SignatureValue Id="${signatureValueId}">\n${signatureValueBase64}\n</ds:SignatureValue>`,
            `\n${keyInfoInner}`,
            `\n<ds:Object Id="${objectId}">`,
            `<etsi:QualifyingProperties Target="#${signatureId}">`,
            `${signedPropertiesInner}`,
            `</etsi:QualifyingProperties>`,
            `</ds:Object>`,
            `</ds:Signature>`,
        ].join('');
        const closingTagIndex = unsignedXml.lastIndexOf(`</${rootElement.tagName}>`);
        if (closingTagIndex === -1) {
            const serializedRoot = new xmldom_1.XMLSerializer().serializeToString(rootElement);
            const fallbackIdx = serializedRoot.lastIndexOf(`</${rootElement.tagName}>`);
            return (serializedRoot.slice(0, fallbackIdx) +
                dsSignatureBlock +
                serializedRoot.slice(fallbackIdx));
        }
        return (unsignedXml.slice(0, closingTagIndex) +
            dsSignatureBlock +
            unsignedXml.slice(closingTagIndex));
    }
    canonicalizeElement(element) {
        const serializer = new xmldom_1.XMLSerializer();
        let xml = serializer.serializeToString(element);
        xml = xml.replace(/<\?xml[^?]*\?>\s*/g, '');
        xml = xml.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        xml = xml.replace(/<([a-zA-Z0-9:_-]+)(\s[^>]*)?\/>/g, '<$1$2></$1>');
        return xml;
    }
    sha1Base64(content) {
        return crypto.createHash('sha1').update(content, 'utf8').digest('base64');
    }
    chunkBase64(b64, lineLength = 76) {
        const clean = b64.replace(/\s+/g, '');
        const chunks = [];
        for (let i = 0; i < clean.length; i += lineLength) {
            chunks.push(clean.slice(i, i + lineLength));
        }
        return chunks.join('\n');
    }
    formatEcuadorIsoDate(date) {
        const offsetMinutes = -5 * 60;
        const localTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
        const iso = localTime.toISOString().replace(/\.\d{3}Z$/, '');
        return `${iso}-05:00`;
    }
    escapeXml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
};
exports.XadesBesSignerService = XadesBesSignerService;
exports.XadesBesSignerService = XadesBesSignerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [p12_parser_service_1.P12ParserService])
], XadesBesSignerService);
//# sourceMappingURL=xades-bes-signer.service.js.map