import { Tenant } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UploadCertificateDto } from './dto/upload-certificate.dto';
export declare class TenantsController {
    private readonly tenantsService;
    constructor(tenantsService: TenantsService);
    registerTenant(dto: CreateTenantDto): Promise<{
        success: boolean;
        tenantId: string;
        name: string;
        ruc: string;
        apiKey: string;
        warning: string;
    }>;
    uploadCertificate(tenant: Tenant, dto: UploadCertificateDto, file?: Express.Multer.File): Promise<{
        success: boolean;
        tenantId: string;
        ruc: string;
        certificate: {
            subject: string | null;
            issuer: string | null;
            validFrom: Date | null;
            validTo: Date | null;
            encryptionAlgorithm: string;
        };
    }>;
}
