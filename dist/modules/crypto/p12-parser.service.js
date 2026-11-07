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
Object.defineProperty(exports, "__esModule", { value: true });
exports.P12ParserService = void 0;
const common_1 = require("@nestjs/common");
const forge = __importStar(require("node-forge"));
let P12ParserService = class P12ParserService {
    extractAndValidate(p12Buffer, password) {
        if (!p12Buffer || p12Buffer.length === 0) {
            throw new common_1.BadRequestException('CERTIFICATE_EMPTY: El archivo .p12 está vacío.');
        }
        let p12;
        try {
            const derBytes = p12Buffer.toString('binary');
            const asn1 = forge.asn1.fromDer(derBytes);
            p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
        }
        catch {
            throw new common_1.BadRequestException('INVALID_CERTIFICATE_PASSWORD: No se pudo abrir el archivo .p12. Verifique el archivo y la contraseña proporcionada.');
        }
        const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
        const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
        const allKeyBags = [...shroudedBags, ...plainKeyBags].filter((b) => b && b.key);
        if (allKeyBags.length === 0) {
            throw new common_1.BadRequestException('PRIVATE_KEY_NOT_FOUND: No se encontró una clave privada dentro del archivo .p12.');
        }
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
        const validCertBags = certBags.filter((b) => b && b.cert);
        if (validCertBags.length === 0) {
            throw new common_1.BadRequestException('CERTIFICATE_NOT_FOUND: No se encontró ningún certificado X.509 dentro del archivo .p12.');
        }
        let selectedKey = allKeyBags[0].key;
        let selectedCert = validCertBags[0].cert;
        for (const keyBag of allKeyBags) {
            const candidateKey = keyBag.key;
            for (const certBag of validCertBags) {
                const candidateCert = certBag.cert;
                const pubKey = candidateCert.publicKey;
                if (pubKey &&
                    candidateKey &&
                    pubKey.n &&
                    candidateKey.n &&
                    pubKey.n.compareTo(candidateKey.n) === 0) {
                    selectedKey = candidateKey;
                    selectedCert = candidateCert;
                    break;
                }
            }
        }
        const now = new Date();
        const validFrom = selectedCert.validity.notBefore;
        const validTo = selectedCert.validity.notAfter;
        if (now > validTo) {
            throw new common_1.BadRequestException(`CERTIFICATE_EXPIRED: El certificado electrónico caducó el ${validTo.toISOString()}.`);
        }
        if (now < validFrom) {
            throw new common_1.BadRequestException(`CERTIFICATE_NOT_YET_VALID: El certificado electrónico aún no entra en vigencia (${validFrom.toISOString()}).`);
        }
        const certAsn1 = forge.pki.certificateToAsn1(selectedCert);
        const certDerBytes = forge.asn1.toDer(certAsn1).getBytes();
        const certDerBase64 = forge.util.encode64(certDerBytes);
        const sha1Md = forge.md.sha1.create();
        sha1Md.update(certDerBytes);
        const certSha1Base64 = forge.util.encode64(sha1Md.digest().getBytes());
        const issuerName = this.formatDistinguishedName(selectedCert.issuer.attributes);
        const subjectName = this.formatDistinguishedName(selectedCert.subject.attributes);
        const cleanHexSerial = (selectedCert.serialNumber || '01').replace(/[^0-9a-fA-F]/g, '');
        const serialNumberDec = BigInt(`0x${cleanHexSerial || '01'}`).toString(10);
        const pubKey = selectedCert.publicKey;
        const modulusHex = pubKey.n.toString(16);
        const paddedModulusHex = modulusHex.length % 2 === 1 ? `0${modulusHex}` : modulusHex;
        const modulusBase64 = Buffer.from(paddedModulusHex, 'hex').toString('base64');
        const exponentHex = pubKey.e.toString(16);
        const paddedExponentHex = exponentHex.length % 2 === 1 ? `0${exponentHex}` : exponentHex;
        const exponentBase64 = Buffer.from(paddedExponentHex, 'hex').toString('base64');
        return {
            privateKey: selectedKey,
            certificate: selectedCert,
            certDerBase64,
            certSha1Base64,
            issuerName,
            subjectName,
            serialNumberDec,
            modulusBase64,
            exponentBase64,
            validFrom,
            validTo,
        };
    }
    formatDistinguishedName(attributes) {
        return [...attributes]
            .reverse()
            .map((attr) => {
            const shortName = attr.shortName ||
                this.mapOidToShortName(attr.type || '') ||
                attr.name ||
                'OID';
            return `${shortName}=${attr.value}`;
        })
            .join(',');
    }
    mapOidToShortName(oid) {
        const map = {
            '2.5.4.3': 'CN',
            '2.5.4.6': 'C',
            '2.5.4.7': 'L',
            '2.5.4.8': 'ST',
            '2.5.4.10': 'O',
            '2.5.4.11': 'OU',
            '2.5.4.5': 'SERIALNUMBER',
        };
        return map[oid];
    }
};
exports.P12ParserService = P12ParserService;
exports.P12ParserService = P12ParserService = __decorate([
    (0, common_1.Injectable)()
], P12ParserService);
//# sourceMappingURL=p12-parser.service.js.map