import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiClient, Certificate, Tenant } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { AccessKeyService } from './services/access-key.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { TenantAccessGuard } from '../tenants/guards/tenant-access.guard';
import { ExecutionContext } from '@nestjs/common';

describe('InvoicesService — Hierarchical Ingestion & Multi-Tenant Isolation', () => {
  let service: InvoicesService;
  let prismaMock: {
    certificate: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    invoiceJob: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    tenant: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let queueMock: {
    add: ReturnType<typeof vi.fn>;
  };

  const mockClient: ApiClient = {
    id: 'client-uuid-1',
    name: 'SaaS Platform Demo',
    apiKeyHash: 'a'.repeat(64),
    webhookUrl: 'https://saas.example.com/fallback-webhook',
    status: 'ACTIVE',
    plan: 'STANDARD',
    rateLimitRps: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenant: Tenant = {
    id: 'tenant-uuid-1',
    apiClientId: 'client-uuid-1',
    businessName: 'Empresa Demo S.A.',
    ruc: '1790011674001',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCertificate: Certificate = {
    id: 'cert-uuid-1',
    tenantId: 'tenant-uuid-1',
    p12Binary: Buffer.from('mock-p12'),
    p12FilePath: null,
    passwordCiphertext: 'cipher',
    passwordIv: 'iv',
    passwordAuthTag: 'tag',
    validFrom: new Date(Date.now() - 86400000), // yesterday
    validTo: new Date(Date.now() + 31536000000), // next year
    certSubject: 'CN=Empresa Demo,OID.2.5.4.97=VATEC-1790011674001',
    certIssuer: 'CN=SECURITY DATA S.A.',
    serialNumber: '12345678',
    isActive: true,
    createdAt: new Date(),
  };

  const validDto: CreateInvoiceDto = {
    referenceId: 'INV-2026-001',
    ambiente: '1',
    webhookUrl: 'https://saas.example.com/custom-webhook',
    razonSocial: 'Empresa Demo S.A.',
    ruc: '1790011674001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000123',
    dirMatriz: 'Quito',
    fechaEmision: '07/11/2026',
    dirEstablecimiento: 'Quito',
    tipoIdentificacionComprador: '04',
    razonSocialComprador: 'Cliente S.A.',
    identificacionComprador: '0991234567001',
    totalSinImpuestos: 100,
    totalDescuento: 0,
    importeTotal: 115,
    pagos: [{ formaPago: '20', total: 115 }],
    detalles: [
      {
        codigoPrincipal: 'P01',
        descripcion: 'Item',
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        precioTotalSinImpuesto: 100,
        impuestos: [
          {
            codigo: '2',
            codigoPorcentaje: '4',
            tarifa: 15,
            baseImponible: 100,
            valor: 15,
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    prismaMock = {
      certificate: {
        findFirst: vi.fn().mockResolvedValue(mockCertificate),
      },
      invoiceJob: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      tenant: {
        findFirst: vi.fn(),
      },
    };
    queueMock = {
      add: vi.fn(),
    };
    service = new InvoicesService(prismaMock as never, new AccessKeyService(), queueMock as never);
  });

  describe('createInvoice (Hierarchical Ingestion)', () => {
    it('should successfully ingest invoice, generate 49-digit claveAcceso, persist QUEUED job, and enqueue in BullMQ (<200ms)', async () => {
      prismaMock.invoiceJob.findFirst.mockResolvedValueOnce(null);
      prismaMock.invoiceJob.create.mockImplementationOnce(async ({ data }) => ({
        id: 'job-uuid-999',
        ...data,
      }));
      queueMock.add.mockResolvedValueOnce({ id: 'job-uuid-999' });

      const startTime = Date.now();
      const result = await service.createInvoice(mockTenant, validDto, mockClient);
      const durationMs = Date.now() - startTime;

      expect(durationMs).toBeLessThan(200);
      expect(result.success).toBe(true);
      expect(result.status).toBe('QUEUED');
      expect(result.referenceId).toBe('INV-2026-001');
      expect(result.claveAcceso).toMatch(/^\d{49}$/);
      expect(result.jobId).toBe('job-uuid-999');

      expect(prismaMock.certificate.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenant.id,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(prismaMock.invoiceJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: mockTenant.id,
          referenceId: validDto.referenceId,
          ambiente: validDto.ambiente,
          status: 'QUEUED',
          webhookUrl: 'https://saas.example.com/custom-webhook',
        }),
      });

      expect(queueMock.add).toHaveBeenCalledWith(
        'process-sri-invoice',
        {
          invoiceJobId: 'job-uuid-999',
          tenantId: mockTenant.id,
          claveAcceso: result.claveAcceso,
        },
        expect.objectContaining({
          jobId: 'job-uuid-999',
        }),
      );
    });

    it('should fall back to apiClient.webhookUrl when dto.webhookUrl is omitted', async () => {
      prismaMock.invoiceJob.findFirst.mockResolvedValueOnce(null);
      prismaMock.invoiceJob.create.mockImplementationOnce(async ({ data }) => ({
        id: 'job-uuid-999',
        ...data,
      }));
      queueMock.add.mockResolvedValueOnce({ id: 'job-uuid-999' });

      const dtoWithoutWebhook: CreateInvoiceDto = {
        ...validDto,
        webhookUrl: undefined as unknown as string,
      };

      await service.createInvoice(mockTenant, dtoWithoutWebhook, mockClient);

      expect(prismaMock.invoiceJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookUrl: 'https://saas.example.com/fallback-webhook',
        }),
      });
    });

    it('should throw ForbiddenException (RUC_MISMATCH) and create no DB/queue records when tenant.ruc !== dto.ruc', async () => {
      const mismatchedDto: CreateInvoiceDto = {
        ...validDto,
        ruc: '0990098765001',
      };

      await expect(service.createInvoice(mockTenant, mismatchedDto, mockClient)).rejects.toThrow(
        /RUC_MISMATCH: El RUC del emisor en el payload \(0990098765001\) no coincide con el RUC del tenant \(1790011674001\)/,
      );

      expect(prismaMock.invoiceJob.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException (MISSING_ACTIVE_CERTIFICATE) when tenant has no active certificate in certificates table', async () => {
      prismaMock.certificate.findFirst.mockResolvedValueOnce(null);

      await expect(service.createInvoice(mockTenant, validDto, mockClient)).rejects.toThrow(
        /MISSING_ACTIVE_CERTIFICATE: El tenant no cuenta con un certificado digital activo/,
      );

      expect(prismaMock.invoiceJob.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException (MISSING_ACTIVE_CERTIFICATE) when certificate is expired', async () => {
      prismaMock.certificate.findFirst.mockResolvedValueOnce({
        ...mockCertificate,
        validTo: new Date(Date.now() - 10000), // expired
      });

      await expect(service.createInvoice(mockTenant, validDto, mockClient)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.invoiceJob.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (DUPLICATE_REFERENCE_ID) on duplicate referenceId for same tenant', async () => {
      prismaMock.invoiceJob.findFirst.mockResolvedValueOnce({
        id: 'existing-job-id',
        claveAcceso: '0711202601179001167400110010010000001231234567815',
      });

      await expect(service.createInvoice(mockTenant, validDto, mockClient)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.invoiceJob.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('should block cross-tenant invoice ingestion via TenantAccessGuard with 403 TENANT_ACCESS_DENIED', async () => {
      prismaMock.tenant.findFirst.mockResolvedValueOnce(null); // Tenant not belonging to client

      const guard = new TenantAccessGuard(prismaMock as never);
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            apiClient: mockClient,
            params: { tenantId: 'tenant-belonging-to-other-client' },
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(mockContext)).rejects.toThrow(/TENANT_ACCESS_DENIED/);

      expect(prismaMock.invoiceJob.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('getInvoiceByClaveAcceso (Hierarchical Status Query)', () => {
    const validClaveAcceso = '1234567890123456789012345678901234567890123456789';

    it('should return 200 OK with job details for an authorized invoice belonging to tenant', async () => {
      const mockJob = {
        id: 'job-uuid-1',
        tenantId: mockTenant.id,
        referenceId: 'INV-2026-001',
        claveAcceso: validClaveAcceso,
        ambiente: '1',
        status: 'AUTORIZADO',
        numeroAutorizacion: validClaveAcceso,
        fechaAutorizacion: new Date('2026-11-07T12:00:00Z'),
        sriMessages: [],
        signedXml: '<signedXml/>',
        authorizedXml: '<authorizedXml/>',
        webhookDelivered: true,
        webhookResponseStatus: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.invoiceJob.findFirst.mockResolvedValueOnce(mockJob);

      const result = await service.getInvoiceByClaveAcceso(mockTenant, validClaveAcceso);

      expect(result.success).toBe(true);
      expect(result.status).toBe('AUTORIZADO');
      expect(result.numeroAutorizacion).toBe(validClaveAcceso);
      expect(result.authorizedXml).toBe('<authorizedXml/>');
      expect(result.signedXml).toBe('<signedXml/>');
      expect(result.referenceId).toBe('INV-2026-001');

      expect(prismaMock.invoiceJob.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenant.id,
          claveAcceso: validClaveAcceso,
        },
      });
    });

    it('should throw NotFoundException (INVOICE_NOT_FOUND) when invoice belongs to another tenant (cross-tenant isolation)', async () => {
      prismaMock.invoiceJob.findFirst.mockResolvedValueOnce(null);

      await expect(service.getInvoiceByClaveAcceso(mockTenant, validClaveAcceso)).rejects.toThrow(
        /INVOICE_NOT_FOUND: No se encontró la factura con la Clave de Acceso especificada para este tenant/,
      );

      expect(prismaMock.invoiceJob.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenant.id,
          claveAcceso: validClaveAcceso,
        },
      });
    });

    it('should throw BadRequestException (INVALID_CLAVE_ACCESO) when claveAcceso has fewer than 49 digits or non-numeric characters', async () => {
      const invalidClaves = [
        '12345',
        '123456789012345678901234567890123456789012345678', // 48 chars
        '12345678901234567890123456789012345678901234567890', // 50 chars
        '123456789012345678901234567890123456789012345678A', // alphanumeric
      ];

      for (const invalidClave of invalidClaves) {
        await expect(service.getInvoiceByClaveAcceso(mockTenant, invalidClave)).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.getInvoiceByClaveAcceso(mockTenant, invalidClave)).rejects.toThrow(
          /INVALID_CLAVE_ACCESO: La clave de acceso debe contener exactamente 49 dígitos numéricos/,
        );
      }

      expect(prismaMock.invoiceJob.findFirst).not.toHaveBeenCalled();
    });
  });
});
