import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';
import { CreateTenantDto, UploadCertificateDto } from './dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aesGcm: AesGcmService,
    private readonly p12Parser: P12ParserService,
  ) {}

  async createTenant(apiClientId: string, dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: {
        apiClientId_ruc: {
          apiClientId,
          ruc: dto.ruc,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `TENANT_RUC_EXISTS: Ya existe una empresa emisora registrada con este RUC (${dto.ruc}) para esta plataforma`,
      );
    }

    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          apiClientId,
          businessName: dto.businessName,
          ruc: dto.ruc,
          status: 'ACTIVE',
        },
      });

      return {
        id: tenant.id,
        businessName: tenant.businessName,
        ruc: tenant.ruc,
        apiClientId: tenant.apiClientId,
        status: tenant.status,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `TENANT_RUC_EXISTS: Ya existe una empresa emisora registrada con este RUC (${dto.ruc}) para esta plataforma`,
        );
      }
      throw error;
    }
  }

  async listTenants(apiClientId: string, query?: { page?: number; limit?: number }) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { apiClientId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({
        where: { apiClientId },
      }),
    ]);

    return {
      success: true,
      items,
      total,
      page,
      limit,
    };
  }

  async uploadCertificate(
    tenant: Tenant,
    dto: UploadCertificateDto,
    fileBuffer: Buffer,
    originalFilename?: string,
  ) {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException(
        'MISSING_CERTIFICATE_FILE: Debe adjuntar un archivo .p12 o .pfx válido.',
      );
    }

    if (
      originalFilename &&
      !originalFilename.toLowerCase().endsWith('.p12') &&
      !originalFilename.toLowerCase().endsWith('.pfx')
    ) {
      throw new BadRequestException(
        'INVALID_FILE_EXTENSION: El certificado debe tener extensión .p12 o .pfx.',
      );
    }

    if (tenant.ruc !== dto.ruc) {
      throw new ForbiddenException(
        `RUC_MISMATCH: El RUC enviado (${dto.ruc}) no coincide con el RUC del tenant autenticado (${tenant.ruc}).`,
      );
    }

    // 1. Validate the .p12 certificate against all 6 SRI security & identity checks:
    //    (Contraseña, Integridad par clave-certificado, Vigencia, Entidad Certificadora, Identidad RUC, Revocación)
    const parsedCert = this.p12Parser.extractAndValidate(fileBuffer, dto.password, {
      expectedRuc: tenant.ruc,
    });
    await this.p12Parser.verifyRevocationStatus(parsedCert.certificate, {
      expectedRuc: tenant.ruc,
    });

    // 2. Encrypt BOTH the certificate password AND the .p12 binary using AES-256-GCM (zero plaintext at rest)
    const encryptedPassword = this.aesGcm.encrypt(dto.password);
    const encryptedP12Buffer = this.aesGcm.encryptBuffer(fileBuffer);

    // 3. Persist AES-256-GCM encrypted binary on protected local disk (0600 permissions)
    const storageDir =
      process.env.CERTIFICATES_STORAGE_DIR || path.resolve(process.cwd(), 'storage/certificates');
    await fs.mkdir(storageDir, { recursive: true });
    const filePath = path.join(storageDir, `${tenant.ruc}_${tenant.id}.p12.enc`);
    await fs.writeFile(filePath, encryptedP12Buffer, { mode: 0o600 });

    // 4. In a Prisma transaction: deactivate prior certificates and persist new Certificate record
    const certificate = await this.prisma.$transaction(async (tx) => {
      await tx.certificate.updateMany({
        where: { tenantId: tenant.id, isActive: true },
        data: { isActive: false },
      });

      return tx.certificate.create({
        data: {
          tenantId: tenant.id,
          p12Binary: new Uint8Array(encryptedP12Buffer),
          p12FilePath: filePath,
          passwordCiphertext: encryptedPassword.ciphertext,
          passwordIv: encryptedPassword.iv,
          passwordAuthTag: encryptedPassword.authTag,
          validFrom: parsedCert.validFrom,
          validTo: parsedCert.validTo,
          certSubject: parsedCert.subjectName,
          certIssuer: parsedCert.issuerName,
          serialNumber: parsedCert.serialNumberHex,
          isActive: true,
        },
      });
    });

    return {
      success: true,
      tenantId: tenant.id,
      ruc: tenant.ruc,
      certificate: {
        id: certificate.id,
        certSubject: certificate.certSubject,
        certIssuer: certificate.certIssuer,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        isActive: certificate.isActive,
        rucVerified: true,
        encryptionAlgorithm: 'AES-256-GCM',
      },
    };
  }
}
