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
var InvoiceQueueConsumer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceQueueConsumer = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const fs = __importStar(require("node:fs/promises"));
const prisma_service_1 = require("../../prisma/prisma.service");
const aes_gcm_service_1 = require("../crypto/aes-gcm.service");
const xades_bes_signer_service_1 = require("../crypto/xades-bes-signer.service");
const xml_builder_service_1 = require("../invoices/services/xml-builder.service");
const invoices_constants_1 = require("../invoices/invoices.constants");
const sri_soap_client_service_1 = require("../sri-soap/sri-soap-client.service");
const webhook_service_1 = require("../webhook/webhook.service");
let InvoiceQueueConsumer = InvoiceQueueConsumer_1 = class InvoiceQueueConsumer extends bullmq_1.WorkerHost {
    prisma;
    aesGcm;
    xmlBuilder;
    xadesSigner;
    sriSoapClient;
    webhookService;
    logger = new common_1.Logger(InvoiceQueueConsumer_1.name);
    constructor(prisma, aesGcm, xmlBuilder, xadesSigner, sriSoapClient, webhookService) {
        super();
        this.prisma = prisma;
        this.aesGcm = aesGcm;
        this.xmlBuilder = xmlBuilder;
        this.xadesSigner = xadesSigner;
        this.sriSoapClient = sriSoapClient;
        this.webhookService = webhookService;
    }
    async process(job) {
        const { invoiceJobId, tenantId, claveAcceso } = job.data;
        this.logger.log(`Processing InvoiceJob ${invoiceJobId} [claveAcceso=${claveAcceso}]`);
        const invoiceJob = await this.prisma.invoiceJob.findUnique({
            where: { id: invoiceJobId },
        });
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
        });
        if (!invoiceJob || !tenant) {
            this.logger.error(`InvoiceJob ${invoiceJobId} or Tenant ${tenantId} not found.`);
            return;
        }
        await this.prisma.invoiceJob.update({
            where: { id: invoiceJobId },
            data: {
                status: 'PROCESSING',
                attempts: { increment: 1 },
            },
        });
        try {
            const p12Buffer = await this.loadTenantP12Buffer(tenant.p12Binary, tenant.p12FilePath);
            if (!tenant.passwordCiphertext || !tenant.passwordIv || !tenant.passwordAuthTag) {
                throw new Error('Credenciales AES-256-GCM del certificado incompletas para el tenant.');
            }
            const certPassword = this.aesGcm.decrypt(tenant.passwordCiphertext, tenant.passwordIv, tenant.passwordAuthTag);
            const payload = invoiceJob.payloadJson;
            const unsignedXml = this.xmlBuilder.buildFacturaXml(payload, claveAcceso);
            const signedXml = this.xadesSigner.signXml(unsignedXml, p12Buffer, certPassword);
            await this.prisma.invoiceJob.update({
                where: { id: invoiceJobId },
                data: {
                    unsignedXml,
                    signedXml,
                },
            });
            const recepcionResult = await this.sriSoapClient.validarComprobante(signedXml, invoiceJob.ambiente);
            if (recepcionResult.estado !== 'RECIBIDA') {
                await this.finalizeAndNotify({
                    invoiceJobId,
                    referenceId: invoiceJob.referenceId,
                    claveAcceso,
                    ambiente: invoiceJob.ambiente,
                    webhookUrl: invoiceJob.webhookUrl,
                    status: 'DEVUELTA',
                    sriMessages: recepcionResult.mensajes,
                });
                return;
            }
            await this.prisma.invoiceJob.update({
                where: { id: invoiceJobId },
                data: { status: 'RECIBIDA' },
            });
            await this.delay(2500);
            let authResult = await this.sriSoapClient.autorizacionComprobante(claveAcceso, invoiceJob.ambiente);
            const maxRetries = 3;
            let retryCount = 0;
            while (authResult.estado === 'EN PROCESO' && retryCount < maxRetries) {
                retryCount++;
                const backoffMs = 2000 * Math.pow(2, retryCount - 1);
                this.logger.warn(`Clave ${claveAcceso} EN PROCESO. Retry ${retryCount}/${maxRetries} in ${backoffMs}ms...`);
                await this.delay(backoffMs);
                authResult = await this.sriSoapClient.autorizacionComprobante(claveAcceso, invoiceJob.ambiente);
            }
            if (authResult.estado === 'AUTORIZADO') {
                await this.finalizeAndNotify({
                    invoiceJobId,
                    referenceId: invoiceJob.referenceId,
                    claveAcceso,
                    ambiente: invoiceJob.ambiente,
                    webhookUrl: invoiceJob.webhookUrl,
                    status: 'AUTORIZADO',
                    numeroAutorizacion: authResult.numeroAutorizacion || claveAcceso,
                    fechaAutorizacion: authResult.fechaAutorizacion,
                    authorizedXml: authResult.authorizedXml || authResult.comprobanteXml,
                    sriMessages: authResult.mensajes,
                });
                return;
            }
            const finalStatus = authResult.estado === 'EN PROCESO' ? 'EN_PROCESO' : 'NO_AUTORIZADO';
            await this.finalizeAndNotify({
                invoiceJobId,
                referenceId: invoiceJob.referenceId,
                claveAcceso,
                ambiente: invoiceJob.ambiente,
                webhookUrl: invoiceJob.webhookUrl,
                status: finalStatus,
                numeroAutorizacion: authResult.numeroAutorizacion,
                fechaAutorizacion: authResult.fechaAutorizacion,
                sriMessages: authResult.mensajes,
            });
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error processing InvoiceJob ${invoiceJobId} [claveAcceso=${claveAcceso}]: ${errMsg}`);
            const failureMessages = [
                {
                    identificador: 'GATEWAY_ERROR',
                    mensaje: errMsg,
                    tipo: 'ERROR',
                },
            ];
            await this.finalizeAndNotify({
                invoiceJobId,
                referenceId: invoiceJob.referenceId,
                claveAcceso,
                ambiente: invoiceJob.ambiente,
                webhookUrl: invoiceJob.webhookUrl,
                status: 'FAILED',
                sriMessages: failureMessages,
            });
        }
    }
    async finalizeAndNotify(params) {
        const parsedFechaAuth = params.fechaAutorizacion
            ? new Date(params.fechaAutorizacion)
            : undefined;
        const validFechaAuth = parsedFechaAuth && !isNaN(parsedFechaAuth.getTime()) ? parsedFechaAuth : undefined;
        const webhookResult = await this.webhookService.dispatch(params.webhookUrl, {
            event: 'sri.invoice.completed',
            jobId: params.invoiceJobId,
            referenceId: params.referenceId,
            claveAcceso: params.claveAcceso,
            ambiente: params.ambiente,
            status: params.status,
            numeroAutorizacion: params.numeroAutorizacion || null,
            fechaAutorizacion: params.fechaAutorizacion || null,
            authorizedXml: params.authorizedXml || null,
            sriMessages: params.sriMessages,
            timestamp: new Date().toISOString(),
        });
        await this.prisma.invoiceJob.update({
            where: { id: params.invoiceJobId },
            data: {
                status: params.status,
                numeroAutorizacion: params.numeroAutorizacion,
                fechaAutorizacion: validFechaAuth,
                authorizedXml: params.authorizedXml,
                sriMessages: params.sriMessages,
                webhookDelivered: webhookResult.delivered,
                webhookResponseStatus: webhookResult.statusCode,
            },
        });
    }
    async loadTenantP12Buffer(p12Binary, p12FilePath) {
        if (p12Binary && p12Binary.byteLength > 0) {
            return Buffer.from(p12Binary);
        }
        if (p12FilePath) {
            return fs.readFile(p12FilePath);
        }
        throw new Error('No se encontró el binario del certificado .p12 para el tenant.');
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};
exports.InvoiceQueueConsumer = InvoiceQueueConsumer;
exports.InvoiceQueueConsumer = InvoiceQueueConsumer = InvoiceQueueConsumer_1 = __decorate([
    (0, bullmq_1.Processor)(invoices_constants_1.SRI_INVOICE_QUEUE),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        aes_gcm_service_1.AesGcmService,
        xml_builder_service_1.XmlBuilderService,
        xades_bes_signer_service_1.XadesBesSignerService,
        sri_soap_client_service_1.SriSoapClientService,
        webhook_service_1.WebhookService])
], InvoiceQueueConsumer);
//# sourceMappingURL=invoice-queue.consumer.js.map