import { Tenant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';
import { CreateTenantDto, UploadCertificateDto } from './dto/upload-certificate.dto';
export declare class TenantsService {
    private readonly prisma;
    private readonly aesGcm;
    private readonly p12Parser;
    constructor(prisma: PrismaService, aesGcm: AesGcmService, p12Parser: P12ParserService);
    createTenant(dto: CreateTenantDto): Promise<{
        success: boolean;
        tenantId: string;
        name: string;
        ruc: string;
        apiKey: string;
        warning: string;
    }>;
    uploadCertificate(tenant: Tenant, dto: UploadCertificateDto, fileBuffer: Buffer, originalFilename?: string): Promise<{
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
