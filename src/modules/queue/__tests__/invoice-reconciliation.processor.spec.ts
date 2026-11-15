import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InvoiceReconciliationProcessor } from '../processors/invoice-reconciliation.processor';
import {
  RECONCILE_INVOICES_JOB,
  SRI_RECONCILIATION_QUEUE,
} from '../../invoices/invoices.constants';

describe('InvoiceReconciliationProcessor — Distributed Scheduler & Reconciliation Sweep', () => {
  const originalEnv = process.env;

  let prismaMock: {
    invoiceJob: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let queueMock: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
  };
  let sriSoapMock: {
    autorizacionComprobante: ReturnType<typeof vi.fn>;
  };
  let webhookMock: {
    dispatch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    prismaMock = {
      invoiceJob: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    queueMock = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    };
    sriSoapMock = {
      autorizacionComprobante: vi.fn(),
    };
    webhookMock = {
      dispatch: vi.fn().mockResolvedValue({ delivered: true, statusCode: 200 }),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('onModuleInit (Scheduler Registration)', () => {
    it('should skip scheduler registration when NODE_ENV === "test"', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.SRI_RECONCILIATION_ENABLED;

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.onModuleInit();

      expect(queueMock.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('should skip scheduler registration when SRI_RECONCILIATION_ENABLED === "false"', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SRI_RECONCILIATION_ENABLED = 'false';

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.onModuleInit();

      expect(queueMock.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('should register distributed recurring scheduler with default cron "* * * * *" and retention options', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SRI_RECONCILIATION_ENABLED = 'true';
      delete process.env.SRI_RECONCILIATION_CRON;

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.onModuleInit();

      expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
        'sri-invoice-reconciliation-job',
        { pattern: '* * * * *' },
        {
          name: RECONCILE_INVOICES_JOB,
          opts: {
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        },
      );
    });

    it('should respect custom SRI_RECONCILIATION_CRON environment variable', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SRI_RECONCILIATION_ENABLED = 'true';
      process.env.SRI_RECONCILIATION_CRON = '*/5 * * * *';

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.onModuleInit();

      expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
        'sri-invoice-reconciliation-job',
        { pattern: '*/5 * * * *' },
        expect.any(Object),
      );
    });
  });

  describe('process (Stale Pending Sweep)', () => {
    it('should complete immediately without querying SRI when no stale pending invoices are found', async () => {
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([]);

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.process();

      expect(prismaMock.invoiceJob.findMany).toHaveBeenCalledTimes(1);
      expect(sriSoapMock.autorizacionComprobante).not.toHaveBeenCalled();
      expect(webhookMock.dispatch).not.toHaveBeenCalled();
    });

    it('should query invoice_jobs with status in [EN_PROCESO, RECIBIDA], updatedAt <= threshold, take: 50, and orderBy createdAt asc', async () => {
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([]);

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      const beforeExecution = Date.now();
      await processor.process();

      expect(prismaMock.invoiceJob.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['EN_PROCESO', 'RECIBIDA'] },
          updatedAt: {
            lte: expect.any(Date),
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      const calledThreshold = prismaMock.invoiceJob.findMany.mock.calls[0][0].where.updatedAt
        .lte as Date;
      const expectedThresholdMin = new Date(beforeExecution - 61000);
      const expectedThresholdMax = new Date(beforeExecution - 59000);
      expect(calledThreshold.getTime()).toBeGreaterThanOrEqual(expectedThresholdMin.getTime());
      expect(calledThreshold.getTime()).toBeLessThanOrEqual(expectedThresholdMax.getTime());
    });

    it('should resolve stale invoice to AUTORIZADO, update DB with authorization metadata, and dispatch signed webhook', async () => {
      const mockStaleInvoice = {
        id: 'stale-inv-1',
        referenceId: 'INV-STALE-1',
        claveAcceso: '0101202601179001234500110010010000000021234567817',
        ambiente: '1',
        status: 'EN_PROCESO',
        webhookUrl: 'https://saas.example.com/webhook',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        updatedAt: new Date('2026-11-07T10:01:00Z'),
      };
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([mockStaleInvoice]);
      sriSoapMock.autorizacionComprobante.mockResolvedValueOnce({
        estado: 'AUTORIZADO',
        numeroAutorizacion: mockStaleInvoice.claveAcceso,
        fechaAutorizacion: '2026-11-07T10:05:00-05:00',
        authorizedXml: '<autorizacion><estado>AUTORIZADO</estado></autorizacion>',
        mensajes: [],
        rawXml: '',
      });

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.process();

      expect(sriSoapMock.autorizacionComprobante).toHaveBeenCalledWith(
        mockStaleInvoice.claveAcceso,
        mockStaleInvoice.ambiente,
      );
      expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith({
        where: { id: mockStaleInvoice.id },
        data: expect.objectContaining({
          status: 'AUTORIZADO',
          numeroAutorizacion: mockStaleInvoice.claveAcceso,
          authorizedXml: '<autorizacion><estado>AUTORIZADO</estado></autorizacion>',
        }),
      });
      expect(webhookMock.dispatch).toHaveBeenCalledWith(
        mockStaleInvoice.webhookUrl,
        expect.objectContaining({
          event: 'sri.invoice.completed',
          jobId: mockStaleInvoice.id,
          referenceId: mockStaleInvoice.referenceId,
          status: 'AUTORIZADO',
        }),
      );
    });

    it('should resolve stale invoice to NO_AUTORIZADO, update DB with SRI messages, and dispatch signed webhook', async () => {
      const mockStaleInvoice = {
        id: 'stale-inv-2',
        referenceId: 'INV-STALE-2',
        claveAcceso: '0101202601179001234500110010010000000021234567818',
        ambiente: '1',
        status: 'EN_PROCESO',
        webhookUrl: 'https://saas.example.com/webhook',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        updatedAt: new Date('2026-11-07T10:01:00Z'),
      };
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([mockStaleInvoice]);
      sriSoapMock.autorizacionComprobante.mockResolvedValueOnce({
        estado: 'NO AUTORIZADO',
        numeroAutorizacion: null,
        fechaAutorizacion: null,
        mensajes: [{ identificador: '45', mensaje: 'RUC DEL RECEPTOR NO VALIDO', tipo: 'ERROR' }],
        rawXml: '',
      });

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.process();

      expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith({
        where: { id: mockStaleInvoice.id },
        data: expect.objectContaining({
          status: 'NO_AUTORIZADO',
          sriMessages: [
            { identificador: '45', mensaje: 'RUC DEL RECEPTOR NO VALIDO', tipo: 'ERROR' },
          ],
        }),
      });
      expect(webhookMock.dispatch).toHaveBeenCalledWith(
        mockStaleInvoice.webhookUrl,
        expect.objectContaining({
          event: 'sri.invoice.completed',
          status: 'NO_AUTORIZADO',
        }),
      );
    });

    it('should keep invoice in EN_PROCESO and touch updatedAt without dispatching webhook when SRI returns EN PROCESO', async () => {
      const mockStaleInvoice = {
        id: 'stale-inv-3',
        referenceId: 'INV-STALE-3',
        claveAcceso: '0101202601179001234500110010010000000021234567819',
        ambiente: '1',
        status: 'EN_PROCESO',
        webhookUrl: 'https://saas.example.com/webhook',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        updatedAt: new Date('2026-11-07T10:01:00Z'),
      };
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([mockStaleInvoice]);
      sriSoapMock.autorizacionComprobante.mockResolvedValueOnce({
        estado: 'EN PROCESO',
        mensajes: [{ identificador: 'INFO', mensaje: 'En procesamiento', tipo: 'INFO' }],
        rawXml: '',
      });

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.process();

      expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith({
        where: { id: mockStaleInvoice.id },
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      });
      expect(webhookMock.dispatch).not.toHaveBeenCalled();
    });

    it('should isolate error when querying single invoice (e.g. ETIMEDOUT) and continue processing remaining items in batch', async () => {
      const invoiceA = {
        id: 'inv-A',
        referenceId: 'REF-A',
        claveAcceso: '0101202601179001234500110010010000000021234567821',
        ambiente: '1',
        status: 'EN_PROCESO',
        webhookUrl: 'https://saas.example.com/webhook',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        updatedAt: new Date('2026-11-07T10:01:00Z'),
      };
      const invoiceB = {
        id: 'inv-B',
        referenceId: 'REF-B',
        claveAcceso: '0101202601179001234500110010010000000021234567822',
        ambiente: '1',
        status: 'EN_PROCESO',
        webhookUrl: 'https://saas.example.com/webhook',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        updatedAt: new Date('2026-11-07T10:01:00Z'),
      };
      prismaMock.invoiceJob.findMany.mockResolvedValueOnce([invoiceA, invoiceB]);
      sriSoapMock.autorizacionComprobante
        .mockRejectedValueOnce(
          Object.assign(new Error('timeout of 25000ms exceeded'), { code: 'ETIMEDOUT' }),
        )
        .mockResolvedValueOnce({
          estado: 'AUTORIZADO',
          numeroAutorizacion: invoiceB.claveAcceso,
          fechaAutorizacion: '2026-11-07T10:05:00-05:00',
          authorizedXml: '<autorizacion><estado>AUTORIZADO</estado></autorizacion>',
          mensajes: [],
          rawXml: '',
        });

      const processor = new InvoiceReconciliationProcessor(
        prismaMock as never,
        queueMock as never,
        sriSoapMock as never,
        webhookMock as never,
      );

      await processor.process();

      // Invoice A should have updatedAt updated to now so it is not immediately re-evaluated
      expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith({
        where: { id: invoiceA.id },
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      });

      // Invoice B should have been processed and resolved to AUTORIZADO
      expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith({
        where: { id: invoiceB.id },
        data: expect.objectContaining({
          status: 'AUTORIZADO',
        }),
      });
      expect(webhookMock.dispatch).toHaveBeenCalledWith(
        invoiceB.webhookUrl,
        expect.objectContaining({
          jobId: invoiceB.id,
          status: 'AUTORIZADO',
        }),
      );
    });
  });
});
