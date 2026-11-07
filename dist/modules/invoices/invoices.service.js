"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoicesService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const prisma_service_1 = require("../../prisma/prisma.service");
const access_key_service_1 = require("./services/access-key.service");
const invoices_constants_1 = require("./invoices.constants");
let InvoicesService = class InvoicesService {
    prisma;
    accessKeyService;
    invoiceQueue;
    constructor(prisma, accessKeyService, invoiceQueue) {
        this.prisma = prisma;
        this.accessKeyService = accessKeyService;
        this.invoiceQueue = invoiceQueue;
    }
    async enqueueInvoice(tenant, dto) {
        if (tenant.ruc !== dto.ruc) {
            throw new common_1.ForbiddenException(`RUC_MISMATCH: El RUC del comprobante (${dto.ruc}) no coincide con el RUC del tenant autenticado (${tenant.ruc}).`);
        }
        if ((!tenant.p12Binary && !tenant.p12FilePath) ||
            !tenant.passwordCiphertext ||
            !tenant.passwordIv ||
            !tenant.passwordAuthTag) {
            throw new common_1.BadRequestException('CERTIFICATE_NOT_CONFIGURED: El tenant aún no tiene un certificado electrónico (.p12) configurado. Suba uno en POST /v1/tenants/certificates.');
        }
        const claveAcceso = this.accessKeyService.generateAccessKey({
            fechaEmision: dto.fechaEmision,
            codDoc: '01',
            ruc: dto.ruc,
            ambiente: dto.ambiente,
            estab: dto.estab,
            ptoEmi: dto.ptoEmi,
            secuencial: dto.secuencial,
            tipoEmision: '1',
        });
        const invoiceJob = await this.prisma.invoiceJob.create({
            data: {
                tenantId: tenant.id,
                referenceId: dto.referenceId,
                claveAcceso,
                ambiente: dto.ambiente,
                status: 'QUEUED',
                webhookUrl: dto.webhookUrl,
                payloadJson: dto,
            },
        });
        const bullJob = await this.invoiceQueue.add(invoices_constants_1.PROCESS_INVOICE_JOB, {
            invoiceJobId: invoiceJob.id,
            tenantId: tenant.id,
            claveAcceso,
        }, {
            jobId: invoiceJob.id,
            removeOnComplete: 100,
            removeOnFail: 500,
        });
        return {
            success: true,
            jobId: String(bullJob.id || invoiceJob.id),
            claveAcceso,
            status: 'QUEUED',
        };
    }
    async getInvoiceByClaveAcceso(tenant, claveAcceso) {
        const job = await this.prisma.invoiceJob.findFirst({
            where: {
                tenantId: tenant.id,
                claveAcceso,
            },
        });
        if (!job) {
            throw new common_1.NotFoundException(`INVOICE_NOT_FOUND: No se encontró un comprobante con clave de acceso ${claveAcceso}.`);
        }
        return {
            success: true,
            jobId: job.id,
            referenceId: job.referenceId,
            claveAcceso: job.claveAcceso,
            ambiente: job.ambiente,
            status: job.status,
            numeroAutorizacion: job.numeroAutorizacion,
            fechaAutorizacion: job.fechaAutorizacion,
            sriMessages: job.sriMessages,
            authorizedXml: job.authorizedXml,
            webhookDelivered: job.webhookDelivered,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        };
    }
};
exports.InvoicesService = InvoicesService;
exports.InvoicesService = InvoicesService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, bullmq_1.InjectQueue)(invoices_constants_1.SRI_INVOICE_QUEUE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        access_key_service_1.AccessKeyService,
        bullmq_2.Queue])
], InvoicesService);
//# sourceMappingURL=invoices.service.js.map