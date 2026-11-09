import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Tenant } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';
import { CreateTenantDto, UploadCertificateDto } from './dto/upload-certificate.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aesGcm: AesGcmService,
    private readonly p12Parser: P12ParserService,
  ) {}

  async createTenant(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { ruc: dto.ruc },
    });

    if (existing) {
      throw new ConflictException(`TENANT_RUC_EXISTS: Ya existe un tenant con el RUC ${dto.ruc}.`);
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

    // 3. Persist AES-256-GCM encrypted binary on protected local disk (0600 permissions) and in database Bytes column
    const storageDir =
      process.env.CERTIFICATES_STORAGE_DIR || path.resolve(process.cwd(), 'storage/certificates');
    await fs.mkdir(storageDir, { recursive: true });
    const filePath = path.join(storageDir, `${tenant.ruc}_${tenant.id}.p12.enc`);
    await fs.writeFile(filePath, encryptedP12Buffer, { mode: 0o600 });

    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        p12Binary: new Uint8Array(encryptedP12Buffer),
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
        rucVerified: true,
        encryptionAlgorithm: 'AES-256-GCM',
      },
    };
  }
}
