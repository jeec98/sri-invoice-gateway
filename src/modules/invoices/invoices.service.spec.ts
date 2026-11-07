import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { AccessKeyService } from './services/access-key.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prismaMock: {
    invoiceJob: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let queueMock: {
    add: ReturnType<typeof vi.fn>;
  };

  const mockTenant: Tenant = {
    id: 'tenant-uuid-1',
    name: 'Empresa Demo S.A.',
    ruc: '1790011674001',
    apiKeyHash: 'a'.repeat(64),
    p12Binary: Buffer.from('mock-p12'),
    p12FilePath: null,
    passwordCiphertext: 'cipher',
    passwordIv: 'iv',
    passwordAuthTag: 'tag',
    certValidFrom: new Date('2026-01-01'),
    certValidTo: new Date('2027-01-01'),
    certSubject: 'CN=Demo',
    certIssuer: 'CN=Issuer',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validDto: CreateInvoiceDto = {
    referenceId: 'INV-2026-001',
    ambiente: '1',
    webhookUrl: 'https://saas.example.com/webhook',
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
      invoiceJob: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    queueMock = {
      add: vi.fn(),
    };
    service = new InvoicesService(
      prismaMock as never,
      new AccessKeyService(),
      queueMock as never,
    );
  });

  it('should throw ForbiddenException (RUC_MISMATCH) when dto.ruc differs from tenant.ruc', async () => {
    await expect(
      service.enqueueInvoice(mockTenant, { ...validDto, ruc: '0999999999001' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw BadRequestException (CERTIFICATE_NOT_CONFIGURED) when tenant has no certificate', async () => {
    const unconfiguredTenant: Tenant = {
      ...mockTenant,
      p12Binary: null,
      p12FilePath: null,
    };

    await expect(
      service.enqueueInvoice(unconfiguredTenant, validDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw ConflictException (DUPLICATE_REFERENCE_ID) on duplicate referenceId for same tenant', async () => {
    prismaMock.invoiceJob.findFirst.mockResolvedValueOnce({
      id: 'existing-job-id',
      claveAcceso: '0711202601179001167400110010010000001231234567815',
    });

    await expect(service.enqueueInvoice(mockTenant, validDto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should generate 49-digit Clave de Acceso, persist QUEUED job, and enqueue in BullMQ', async () => {
    prismaMock.invoiceJob.findFirst.mockResolvedValueOnce(null);
    prismaMock.invoiceJob.create.mockImplementationOnce(async ({ data }) => ({
      id: 'job-uuid-999',
      ...data,
    }));
    queueMock.add.mockResolvedValueOnce({ id: 'job-uuid-999' });

    const result = await service.enqueueInvoice(mockTenant, validDto);

    expect(result.success).toBe(true);
    expect(result.status).toBe('QUEUED');
    expect(result.claveAcceso).toMatch(/^\d{49}$/);
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });
});

