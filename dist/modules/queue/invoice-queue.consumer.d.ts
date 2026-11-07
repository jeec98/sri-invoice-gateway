import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { XadesBesSignerService } from '../crypto/xades-bes-signer.service';
import { XmlBuilderService } from '../invoices/services/xml-builder.service';
import { SriSoapClientService } from '../sri-soap/sri-soap-client.service';
import { WebhookService } from '../webhook/webhook.service';
export interface InvoiceQueueJobData {
    invoiceJobId: string;
    tenantId: string;
    claveAcceso: string;
}
export declare class InvoiceQueueConsumer extends WorkerHost {
    private readonly prisma;
    private readonly aesGcm;
    private readonly xmlBuilder;
    private readonly xadesSigner;
    private readonly sriSoapClient;
    private readonly webhookService;
    private readonly logger;
    constructor(prisma: PrismaService, aesGcm: AesGcmService, xmlBuilder: XmlBuilderService, xadesSigner: XadesBesSignerService, sriSoapClient: SriSoapClientService, webhookService: WebhookService);
    process(job: Job<InvoiceQueueJobData>): Promise<void>;
    private finalizeAndNotify;
    private loadTenantP12Buffer;
    private delay;
}
