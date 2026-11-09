import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import * as fs from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('TenantsService — Multi-SaaS Multi-Tenant Management', () => {
  let service: TenantsService;
  let prismaMock: {
    tenant: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    certificate: {
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let p12ParserMock: {
    extractAndValidate: ReturnType<typeof vi.fn>;
    verifyRevocationStatus: ReturnType<typeof vi.fn>;
  };

  const mockTenant1: Tenant = {
    id: 'tenant-uuid-1',
    apiClientId: 'client-uuid-1',
    businessName: 'ACME Corp Ecuador',
    ruc: '1790011674001',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockTenant2: Tenant = {
    id: 'tenant-uuid-2',
    apiClientId: 'client-uuid-1',
    businessName: 'Distribuidora del Valle',
    ruc: '1790011674002',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = {
      tenant: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      certificate: {
        updateMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return Promise.all(cb);
      }),
    };

    p12ParserMock = {
      extractAndValidate: vi.fn().mockReturnValue({
        certificate: {},
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2028-01-01T00:00:00.000Z'),
        subjectName: 'CN=ACME Corp Ecuador,C=EC',
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

  describe('createTenant (4.4 RED)', () => {
    it('should register an Empresa Emisora under authenticated SaaS without generating an API key', async () => {
      prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
      prismaMock.tenant.create.mockResolvedValueOnce({
        id: 'tenant-uuid-1',
        apiClientId: 'client-uuid-1',
        businessName: 'ACME Corp Ecuador',
        ruc: '1790011674001',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createTenant('client-uuid-1', {
        businessName: 'ACME Corp Ecuador',
        ruc: '1790011674001',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('tenant-uuid-1');
      expect(result.businessName).toBe('ACME Corp Ecuador');
      expect(result.ruc).toBe('1790011674001');
      expect(result.apiClientId).toBe('client-uuid-1');
      expect(result.status).toBe('ACTIVE');
      expect((result as any).apiKey).toBeUndefined();
      expect((result as any).apiKeyHash).toBeUndefined();

      expect(prismaMock.tenant.create).toHaveBeenCalledWith({
        data: {
          apiClientId: 'client-uuid-1',
          businessName: 'ACME Corp Ecuador',
          ruc: '1790011674001',
          status: 'ACTIVE',
        },
      });
    });

    it('should throw 409 ConflictException (TENANT_RUC_EXISTS) when duplicate RUC under same SaaS platform', async () => {
      // Simulate unique constraint violation @@unique([apiClientId, ruc])
      prismaMock.tenant.findUnique.mockResolvedValue(mockTenant1);

      await expect(
        service.createTenant('client-uuid-1', {
          businessName: 'ACME Clone',
          ruc: '1790011674001',
        }),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.createTenant('client-uuid-1', {
          businessName: 'ACME Clone',
          ruc: '1790011674001',
        }),
      ).rejects.toThrow(/TENANT_RUC_EXISTS/);
    });

    it('should handle Prisma P2002 error as 409 ConflictException', async () => {
      prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.4.0',
      });
      prismaMock.tenant.create.mockRejectedValueOnce(prismaError);

      await expect(
        service.createTenant('client-uuid-1', {
          businessName: 'ACME Corp',
          ruc: '1790011674001',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow same RUC registered by different SaaS platforms (Multi-SaaS Independence)', async () => {
      prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
      prismaMock.tenant.create.mockResolvedValueOnce({
        id: 'tenant-uuid-diff-client',
        apiClientId: 'client-uuid-2',
        businessName: 'ACME under Platform B',
        ruc: '1790011674001',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createTenant('client-uuid-2', {
        businessName: 'ACME under Platform B',
        ruc: '1790011674001',
      });

      expect(result.apiClientId).toBe('client-uuid-2');
      expect(result.ruc).toBe('1790011674001');
      expect(prismaMock.tenant.create).toHaveBeenCalledWith({
        data: {
          apiClientId: 'client-uuid-2',
          businessName: 'ACME under Platform B',
          ruc: '1790011674001',
          status: 'ACTIVE',
        },
      });
    });
  });

  describe('listTenants (4.4 RED)', () => {
    it('should retrieve tenants belonging strictly to authenticated SaaS platform with pagination', async () => {
      prismaMock.tenant.findMany.mockResolvedValueOnce([mockTenant1, mockTenant2]);
      prismaMock.tenant.count.mockResolvedValueOnce(2);

      const result = await service.listTenants('client-uuid-1', { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('tenant-uuid-1');
      expect(result.items[1].id).toBe('tenant-uuid-2');
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);

      expect(prismaMock.tenant.findMany).toHaveBeenCalledWith({
        where: { apiClientId: 'client-uuid-1' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty items array ([]) when client has 0 registered tenants', async () => {
      prismaMock.tenant.findMany.mockResolvedValueOnce([]);
      prismaMock.tenant.count.mockResolvedValueOnce(0);

      const result = await service.listTenants('client-uuid-new', { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaMock.tenant.findMany).toHaveBeenCalledWith({
        where: { apiClientId: 'client-uuid-new' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('uploadCertificate (4.7 RED)', () => {
    const mockFileBuffer = Buffer.from('mock-p12-content');
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const validTo = new Date('2028-01-01T00:00:00.000Z');

    it('should successfully parse .p12, encrypt password with AES-256-GCM, deactivate prior certs, and persist active Certificate record', async () => {
      const createdCertRecord = {
        id: 'cert-uuid-1',
        tenantId: mockTenant1.id,
        p12Binary: new Uint8Array([1, 2, 3]),
        p12FilePath: `/storage/certificates/${mockTenant1.ruc}_${mockTenant1.id}.p12.enc`,
        passwordCiphertext: 'encrypted-pw',
        passwordIv: 'iv-12',
        passwordAuthTag: 'tag-16',
        validFrom,
        validTo,
        certSubject: 'CN=ACME Corp Ecuador,C=EC',
        certIssuer: 'CN=SECURITY DATA,C=EC',
        serialNumber: '12345678',
        isActive: true,
        createdAt: new Date(),
      };

      prismaMock.certificate.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.certificate.create.mockResolvedValueOnce(createdCertRecord);

      const result = await service.uploadCertificate(
        mockTenant1,
        { ruc: mockTenant1.ruc, password: 'ValidPassword123' },
        mockFileBuffer,
        'firma.p12',
      );

      expect(result.success).toBe(true);
      expect(result.certificate).toBeDefined();
      expect(result.certificate.id).toBe('cert-uuid-1');
      expect(result.certificate.certSubject).toBe('CN=ACME Corp Ecuador,C=EC');
      expect(result.certificate.certIssuer).toBe('CN=SECURITY DATA,C=EC');
      expect(result.certificate.validFrom).toEqual(validFrom);
      expect(result.certificate.validTo).toEqual(validTo);
      expect(result.certificate.isActive).toBe(true);
      expect((result.certificate as any).passwordCiphertext).toBeUndefined();
      expect((result as any).password).toBeUndefined();

      // Verify P12 parser was called with expected RUC from tenant
      expect(p12ParserMock.extractAndValidate).toHaveBeenCalledWith(
        mockFileBuffer,
        'ValidPassword123',
        { expectedRuc: mockTenant1.ruc },
      );
      expect(p12ParserMock.verifyRevocationStatus).toHaveBeenCalled();

      // Verify previous certs were deactivated
      expect(prismaMock.certificate.updateMany).toHaveBeenCalledWith({
        where: { tenantId: mockTenant1.id, isActive: true },
        data: { isActive: false },
      });

      // Verify new Certificate was created with AES-256-GCM ciphertext, IV, authTag
      expect(prismaMock.certificate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: mockTenant1.id,
            isActive: true,
            passwordCiphertext: expect.any(String),
            passwordIv: expect.any(String),
            passwordAuthTag: expect.any(String),
            certSubject: 'CN=ACME Corp Ecuador,C=EC',
            certIssuer: 'CN=SECURITY DATA,C=EC',
          }),
        }),
      );

      // Verify disk storage permissions 0o600
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${mockTenant1.ruc}_${mockTenant1.id}.p12.enc`),
        expect.any(Buffer),
        { mode: 0o600 },
      );
    });

    it('should throw BadRequestException (INVALID_CERTIFICATE_PASSWORD) when password is wrong or corrupted', async () => {
      p12ParserMock.extractAndValidate.mockImplementation(() => {
        throw new BadRequestException(
          'INVALID_CERTIFICATE_PASSWORD: La contraseña del certificado .p12/.pfx es incorrecta o el archivo está corrupto',
        );
      });

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'WrongPassword' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'WrongPassword' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(/INVALID_CERTIFICATE_PASSWORD/);
    });

    it('should throw BadRequestException (UNRECOGNIZED_CA) when certificate issuer is unaccredited', async () => {
      p12ParserMock.extractAndValidate.mockImplementation(() => {
        throw new BadRequestException(
          'UNRECOGNIZED_CA: El certificado no fue emitido por una entidad de certificación acreditada por ARCOTEL',
        );
      });

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(/UNRECOGNIZED_CA/);
    });

    it('should throw BadRequestException (CERTIFICATE_RUC_MISMATCH) when cert RUC does not match tenant.ruc', async () => {
      p12ParserMock.extractAndValidate.mockImplementation(() => {
        throw new BadRequestException(
          'CERTIFICATE_RUC_MISMATCH: El RUC del certificado (0990098765001) no coincide con el RUC del tenant (1790011674001)',
        );
      });

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(/CERTIFICATE_RUC_MISMATCH/);
    });

    it('should throw BadRequestException (CERTIFICATE_EXPIRED) when certificate validTo is in the past', async () => {
      p12ParserMock.extractAndValidate.mockImplementation(() => {
        throw new BadRequestException('CERTIFICATE_EXPIRED: El certificado digital ha expirado');
      });

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'valid-pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(/CERTIFICATE_EXPIRED/);
    });

    it('should reject when file extension is not .p12 or .pfx', async () => {
      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: mockTenant1.ruc, password: 'pw' },
          mockFileBuffer,
          'cert.pem',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when dto.ruc does not match tenant.ruc', async () => {
      await expect(
        service.uploadCertificate(
          mockTenant1,
          { ruc: '0999999999001', password: 'pw' },
          mockFileBuffer,
          'firma.p12',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
