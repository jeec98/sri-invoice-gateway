import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import * as fs from 'node:fs/promises';
import { TenantsService } from './tenants.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('TenantsService', () => {
  let service: TenantsService;
  let prismaMock: {
    tenant: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let p12ParserMock: {
    extractAndValidate: ReturnType<typeof vi.fn>;
    verifyRevocationStatus: ReturnType<typeof vi.fn>;
  };

  const mockTenant: Tenant = {
    id: 'tenant-123',
    name: 'Empresa Demo S.A.',
    ruc: '1790011674001',
    apiKeyHash: 'a'.repeat(64),
    p12Binary: null,
    p12FilePath: null,
    passwordCiphertext: null,
    passwordIv: null,
    passwordAuthTag: null,
    certValidFrom: null,
    certValidTo: null,
    certSubject: null,
    certIssuer: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = {
      tenant: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    p12ParserMock = {
      extractAndValidate: vi.fn().mockReturnValue({
        certificate: {},
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2028-01-01T00:00:00.000Z'),
        subjectName: 'CN=EMPRESA DEMO S.A.,C=EC',
        issuerName: 'CN=SECURITY DATA,C=EC',
      }),
      verifyRevocationStatus: vi.fn().mockResolvedValue(undefined),
    };

    service = new TenantsService(
      prismaMock as never,
      new AesGcmService(),
      p12ParserMock as unknown as P12ParserService,
    );
  });

  it('should throw ConflictException (TENANT_RUC_EXISTS) if RUC is already registered', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(mockTenant);

    await expect(
      service.createTenant({ name: 'Otra Empresa', ruc: '1790011674001' }),
    ).rejects.toThrow(ConflictException);
  });

  it('should create tenant with SHA-256 hashed API key and return raw apiKey once', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
    prismaMock.tenant.create.mockImplementationOnce(async ({ data }) => ({
      id: 'tenant-new-1',
      ...data,
    }));

    const result = await service.createTenant({
      name: 'Importadora S.A.',
      ruc: '1790011674001',
    });

    expect(result.success).toBe(true);
    expect(result.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
    expect(prismaMock.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruc: '1790011674001',
          apiKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it('should reject certificate upload if file extension is not .p12 or .pfx', async () => {
    await expect(
      service.uploadCertificate(
        mockTenant,
        { ruc: '1790011674001', password: 'secret' },
        Buffer.from('dummy'),
        'certificado.pem',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject certificate upload if dto.ruc does not match authenticated tenant.ruc', async () => {
    await expect(
      service.uploadCertificate(
        mockTenant,
        { ruc: '0999999999001', password: 'secret' },
        Buffer.from('dummy'),
        'firma.p12',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should validate .p12, encrypt password with AES-256-GCM, and persist with 0600 mode', async () => {
    prismaMock.tenant.update.mockImplementationOnce(async ({ data }) => ({
      ...mockTenant,
      ...data,
    }));

    const result = await service.uploadCertificate(
      mockTenant,
      { ruc: '1790011674001', password: 'MyP12Password' },
      Buffer.from('p12-bytes'),
      'firma.p12',
    );

    expect(result.success).toBe(true);
    expect(result.certificate.encryptionAlgorithm).toBe('AES-256-GCM');
    expect(result.certificate.rucVerified).toBe(true);
    expect(p12ParserMock.extractAndValidate).toHaveBeenCalledWith(
      expect.any(Buffer),
      'MyP12Password',
      { expectedRuc: '1790011674001' },
    );
    expect(p12ParserMock.verifyRevocationStatus).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('1790011674001_tenant-123.p12.enc'),
      expect.any(Buffer),
      { mode: 0o600 },
    );
    expect(prismaMock.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-123' },
        data: expect.objectContaining({
          passwordCiphertext: expect.any(String),
          passwordIv: expect.any(String),
          passwordAuthTag: expect.any(String),
        }),
      }),
    );
  });
});
