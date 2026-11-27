import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { InvoicesController } from './invoices.controller';
import { RetentionsController } from './retentions.controller';
import { InvoicesService, EnqueueDocumentResult } from './invoices.service';
import { Tenant, ApiClient } from '@prisma/client';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateRetentionDto } from './dto/create-retention.dto';

describe('InvoicesController & RetentionsController — Dynamic Idempotency Status Codes', () => {
  let invoicesController: InvoicesController;
  let retentionsController: RetentionsController;
  let invoicesServiceMock: {
    createInvoice: ReturnType<typeof vi.fn>;
    createRetention: ReturnType<typeof vi.fn>;
    getInvoiceByClaveAcceso: ReturnType<typeof vi.fn>;
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

  const mockApiClient: ApiClient = {
    id: 'client-uuid-1',
    name: 'SaaS Platform Demo',
    ruc: '1799999999001',
    apiKeyHash: 'hash',
    webhookUrl: 'https://saas.example.com/webhook',
    webhookSecret: null,
    status: 'ACTIVE',
    plan: 'STANDARD',
    rateLimitRps: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockResponse = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  };

  beforeEach(() => {
    invoicesServiceMock = {
      createInvoice: vi.fn(),
      createRetention: vi.fn(),
      getInvoiceByClaveAcceso: vi.fn(),
    };
    invoicesController = new InvoicesController(invoicesServiceMock as unknown as InvoicesService);
    retentionsController = new RetentionsController(
      invoicesServiceMock as unknown as InvoicesService,
    );
  });

  describe('InvoicesController.createInvoice', () => {
    it('should set HTTP 202 Accepted when isNew is true (first-time ingestion)', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: true,
        isRetry: false,
        jobId: 'job-1',
        referenceId: 'INV-1',
        claveAcceso: '0101202601179001167400110010010000000011234567815',
        status: 'QUEUED',
      };
      invoicesServiceMock.createInvoice.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await invoicesController.createInvoice(
        mockTenant,
        mockApiClient,
        {} as CreateInvoiceDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });

    it('should set HTTP 200 OK when isNew is false and isRetry is false (idempotent replay of existing invoice)', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: false,
        isRetry: false,
        jobId: 'job-1',
        referenceId: 'INV-1',
        claveAcceso: '0101202601179001167400110010010000000011234567815',
        status: 'AUTORIZADO',
      };
      invoicesServiceMock.createInvoice.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await invoicesController.createInvoice(
        mockTenant,
        mockApiClient,
        {} as CreateInvoiceDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('should set HTTP 202 Accepted when isNew is false and isRetry is true (reactivated FAILED invoice)', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: false,
        isRetry: true,
        jobId: 'job-1-retry-123',
        referenceId: 'INV-1',
        claveAcceso: '0101202601179001167400110010010000000011234567815',
        status: 'QUEUED',
      };
      invoicesServiceMock.createInvoice.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await invoicesController.createInvoice(
        mockTenant,
        mockApiClient,
        {} as CreateInvoiceDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });
  });

  describe('RetentionsController.createRetention', () => {
    it('should set HTTP 202 Accepted when isNew is true for new retention', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: true,
        isRetry: false,
        jobId: 'ret-1',
        referenceId: 'RET-1',
        claveAcceso: '0101202607179001167400110010010000000011234567819',
        status: 'QUEUED',
      };
      invoicesServiceMock.createRetention.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await retentionsController.createRetention(
        mockTenant,
        mockApiClient,
        {} as CreateRetentionDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });

    it('should set HTTP 200 OK when isNew is false and isRetry is false for existing retention', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: false,
        isRetry: false,
        jobId: 'ret-1',
        referenceId: 'RET-1',
        claveAcceso: '0101202607179001167400110010010000000011234567819',
        status: 'AUTORIZADO',
      };
      invoicesServiceMock.createRetention.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await retentionsController.createRetention(
        mockTenant,
        mockApiClient,
        {} as CreateRetentionDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('should set HTTP 202 Accepted when isNew is false and isRetry is true for reactivated FAILED retention', async () => {
      const mockResult: EnqueueDocumentResult = {
        success: true,
        isNew: false,
        isRetry: true,
        jobId: 'ret-1-retry-123',
        referenceId: 'RET-1',
        claveAcceso: '0101202607179001167400110010010000000011234567819',
        status: 'QUEUED',
      };
      invoicesServiceMock.createRetention.mockResolvedValueOnce(mockResult);
      const res = createMockResponse();

      const result = await retentionsController.createRetention(
        mockTenant,
        mockApiClient,
        {} as CreateRetentionDto,
        res,
      );

      expect(result).toBe(mockResult);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });
  });
});
