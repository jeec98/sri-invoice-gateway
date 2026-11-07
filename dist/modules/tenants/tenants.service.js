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
exports.TenantsService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const prisma_service_1 = require("../../prisma/prisma.service");
const aes_gcm_service_1 = require("../crypto/aes-gcm.service");
const p12_parser_service_1 = require("../crypto/p12-parser.service");
let TenantsService = class TenantsService {
    prisma;
    aesGcm;
    p12Parser;
    constructor(prisma, aesGcm, p12Parser) {
        this.prisma = prisma;
        this.aesGcm = aesGcm;
        this.p12Parser = p12Parser;
    }
    async createTenant(dto) {
        const existing = await this.prisma.tenant.findUnique({
            where: { ruc: dto.ruc },
        });
        if (existing) {
            throw new common_1.ConflictException(`TENANT_RUC_EXISTS: Ya existe un tenant con el RUC ${dto.ruc}.`);
        }
        const rawApiKey = `sri_live_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
        const tenant = await this.prisma.tenant.create({
            data: {
                name: dto.name,
                ruc: dto.ruc,
                apiKeyHash,
                isActive: true,
            },
        });
        return {
            success: true,
            tenantId: tenant.id,
            name: tenant.name,
            ruc: tenant.ruc,
            apiKey: rawApiKey,
            warning: 'Guarde esta API Key en un lugar seguro. No volverá a mostrarse en texto plano.',
        };
    }
    async uploadCertificate(tenant, dto, fileBuffer, originalFilename) {
        if (!fileBuffer || fileBuffer.length === 0) {
            throw new common_1.BadRequestException('MISSING_CERTIFICATE_FILE: Debe adjuntar un archivo .p12 o .pfx válido.');
        }
        if (originalFilename &&
            !originalFilename.toLowerCase().endsWith('.p12') &&
            !originalFilename.toLowerCase().endsWith('.pfx')) {
            throw new common_1.BadRequestException('INVALID_FILE_EXTENSION: El certificado debe tener extensión .p12 o .pfx.');
        }
        if (tenant.ruc !== dto.ruc) {
            throw new common_1.ForbiddenException(`RUC_MISMATCH: El RUC enviado (${dto.ruc}) no coincide con el RUC del tenant autenticado (${tenant.ruc}).`);
        }
        const parsedCert = this.p12Parser.extractAndValidate(fileBuffer, dto.password);
        const encryptedPassword = this.aesGcm.encrypt(dto.password);
        const storageDir = process.env.CERTIFICATES_STORAGE_DIR || path.resolve(process.cwd(), 'storage/certificates');
        await fs.mkdir(storageDir, { recursive: true });
        const filePath = path.join(storageDir, `${tenant.ruc}_${tenant.id}.p12`);
        await fs.writeFile(filePath, fileBuffer, { mode: 0o600 });
        const updated = await this.prisma.tenant.update({
            where: { id: tenant.id },
            data: {
                p12Binary: new Uint8Array(fileBuffer),
                p12FilePath: filePath,
                passwordCiphertext: encryptedPassword.ciphertext,
                passwordIv: encryptedPassword.iv,
                passwordAuthTag: encryptedPassword.authTag,
                certValidFrom: parsedCert.validFrom,
                certValidTo: parsedCert.validTo,
                certSubject: parsedCert.subjectName,
                certIssuer: parsedCert.issuerName,
            },
        });
        return {
            success: true,
            tenantId: updated.id,
            ruc: updated.ruc,
            certificate: {
                subject: updated.certSubject,
                issuer: updated.certIssuer,
                validFrom: updated.certValidFrom,
                validTo: updated.certValidTo,
                encryptionAlgorithm: 'AES-256-GCM',
            },
        };
    }
};
exports.TenantsService = TenantsService;
exports.TenantsService = TenantsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        aes_gcm_service_1.AesGcmService,
        p12_parser_service_1.P12ParserService])
], TenantsService);
//# sourceMappingURL=tenants.service.js.map