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
exports.AccessKeyService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("node:crypto"));
let AccessKeyService = class AccessKeyService {
    generateAccessKey(params) {
        const fecha = this.normalizeFechaToDdmmaaaa(params.fechaEmision);
        const tipoComprobante = (params.codDoc || '01').padStart(2, '0');
        const ruc = params.ruc.trim();
        if (!/^\d{13}$/.test(ruc)) {
            throw new common_1.BadRequestException('INVALID_RUC: El RUC debe tener exactamente 13 dígitos numéricos.');
        }
        const ambiente = String(params.ambiente).trim();
        if (ambiente !== '1' && ambiente !== '2') {
            throw new common_1.BadRequestException('INVALID_AMBIENTE: El ambiente debe ser "1" (Pruebas) o "2" (Producción).');
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
            throw new common_1.BadRequestException(`INVALID_ACCESS_KEY_BASE: La base de la clave de acceso debe tener 48 dígitos numéricos (obtenido: ${base48.length}).`);
        }
        const checkDigit = this.computeModulo11(base48);
        return `${base48}${checkDigit}`;
    }
    computeModulo11(base48) {
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
    normalizeFechaToDdmmaaaa(fechaInput) {
        const clean = fechaInput.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
            return clean.replace(/\//g, '');
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
            const [yyyy, mm, dd] = clean.split('-');
            return `${dd}${mm}${yyyy}`;
        }
        if (/^\d{8}$/.test(clean)) {
            return clean;
        }
        throw new common_1.BadRequestException(`INVALID_DATE_FORMAT: Formato de fecha inválido "${fechaInput}". Use "dd/mm/yyyy" o "yyyy-mm-dd".`);
    }
};
exports.AccessKeyService = AccessKeyService;
exports.AccessKeyService = AccessKeyService = __decorate([
    (0, common_1.Injectable)()
], AccessKeyService);
//# sourceMappingURL=access-key.service.js.map