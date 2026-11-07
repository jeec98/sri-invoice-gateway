import { Queue } from 'bullmq';
import { Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessKeyService } from './services/access-key.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
export declare class InvoicesService {
    private readonly prisma;
    private readonly accessKeyService;
    private readonly invoiceQueue;
    constructor(prisma: PrismaService, accessKeyService: AccessKeyService, invoiceQueue: Queue);
    enqueueInvoice(tenant: Tenant, dto: CreateInvoiceDto): Promise<{
        success: boolean;
        jobId: string;
        claveAcceso: string;
        status: string;
    }>;
    getInvoiceByClaveAcceso(tenant: Tenant, claveAcceso: string): Promise<{
        success: boolean;
        jobId: string;
        referenceId: string;
        claveAcceso: string;
        ambiente: string;
        status: string;
        numeroAutorizacion: string | null;
        fechaAutorizacion: Date | null;
        sriMessages: Prisma.JsonValue;
        authorizedXml: string | null;
        webhookDelivered: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
