import { Tenant } from '@prisma/client';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';
export declare class InvoicesController {
    private readonly invoicesService;
    constructor(invoicesService: InvoicesService);
    createInvoice(tenant: Tenant, dto: CreateInvoiceDto): Promise<{
        success: boolean;
        jobId: string;
        claveAcceso: string;
        status: string;
    }>;
    getInvoiceStatus(tenant: Tenant, claveAcceso: string): Promise<{
        success: boolean;
        jobId: string;
        referenceId: string;
        claveAcceso: string;
        ambiente: string;
        status: string;
        numeroAutorizacion: string | null;
        fechaAutorizacion: Date | null;
        sriMessages: import("@prisma/client/runtime/library").JsonValue;
        authorizedXml: string | null;
        webhookDelivered: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
