import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Job } from 'bullmq';
import { Certificate, Tenant, ApiClient } from '@prisma/client';
import { InvoiceQueueConsumer, InvoiceQueueJobData } from './invoice-queue.consumer';

describe('InvoiceQueueConsumer — Hierarchical Certificate Resolution & Webhook Fallback', () => {
  let consumer: InvoiceQueueConsumer;
  let callOrder: string[];
  let prismaMock: {
    invoiceJob: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    tenant: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    certificate: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let aesGcmMock: {
    decrypt: ReturnType<typeof vi.fn>;
    decryptBuffer: ReturnType<typeof vi.fn>;
  };
  let xmlBuilderMock: {
    buildFacturaXml: ReturnType<typeof vi.fn>;
  };
  let xadesSignerMock: {
    signXml: ReturnType<typeof vi.fn>;
  };
  let sriSoapMock: {
    validarComprobante: ReturnType<typeof vi.fn>;
    autorizacionComprobante: ReturnType<typeof vi.fn>;
  };
  let webhookMock: {
    dispatch: ReturnType<typeof vi.fn>;
  };

  const mockApiClient: ApiClient = {
    id: 'client-1',
    name: 'SaaS Platform Root',
    apiKeyHash: 'hash-1',
    webhookUrl: 'https://api.saasplatform.com/sri-callback',
    status: 'ACTIVE',
    plan: 'STANDARD',
    rateLimitRps: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenant: Tenant & { apiClient: ApiClient } = {
    id: 'tenant-1',
    apiClientId: 'client-1',
    businessName: 'ACME Corp Ecuador',
    ruc: '1790011674001',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    apiClient: mockApiClient,
  };

  const mockActiveCert: Certificate = {
    id: 'cert-1',
    tenantId: 'tenant-1',
    p12Binary: Buffer.from('mock-p12-data'),
    p12FilePath: null,
    passwordCiphertext: 'encrypted-pwd-ciphertext',
    passwordIv: '12-byte-iv',
    passwordAuthTag: '16-byte-auth-tag',
    validFrom: new Date(Date.now() - 86400000), // yesterday
    validTo: new Date(Date.now() + 31536000000), // 1 year from now
    certSubject: 'CN=ACME Corp,OID.2.5.4.97=VATEC-1790011674001',
    certIssuer: 'CN=SECURITY DATA S.A.',
    serialNumber: '99887766',
    isActive: true,
    createdAt: new Date(),
  };

  const mockJobData: InvoiceQueueJobData = {
    invoiceJobId: 'job-1',
    tenantId: 'tenant-1',
    claveAcceso: '0711202601179001167400110010010000001231234567815',
  };

  beforeEach(() => {
    callOrder = [];
    prismaMock = {
      invoiceJob: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-1',
          tenantId: 'tenant-1',
          referenceId: 'INV-100',
          claveAcceso: '0711202601179001167400110010010000001231234567815',
          ambiente: '1',
          webhookUrl: 'https://saas.example.com/custom-webhook',
          payloadJson: { ruc: '1790011674001' },
        }),
        update: vi.fn().mockImplementation(async ({ data }) => {
          if (data.status === 'AUTORIZADO') {
            callOrder.push('db:persist-authorized');
          } else if (data.status === 'FAILED') {
            callOrder.push('db:persist-failed');
          } else if (data.webhookDelivered !== undefined) {
            callOrder.push('db:persist-webhook-status');
          }
          return {};
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue(mockTenant),
      },
      certificate: {
        findFirst: vi.fn().mockResolvedValue(mockActiveCert),
      },
    };

    aesGcmMock = {
      decrypt: vi.fn().mockReturnValue('decrypted-cert-password'),
      decryptBuffer: vi.fn().mockImplementation((buf: Buffer) => buf),
    };
    xmlBuilderMock = {
      buildFacturaXml: vi.fn().mockReturnValue('<factura id="comprobante"/>'),
    };
    xadesSignerMock = {
      signXml: vi.fn().mockReturnValue('<factura id="comprobante"><ds:Signature/></factura>'),
    };
    sriSoapMock = {
      validarComprobante: vi.fn().mockResolvedValue({
        estado: 'RECIBIDA',
        mensajes: [],
        rawXml: '',
      }),
      autorizacionComprobante: vi.fn().mockResolvedValue({
        estado: 'AUTORIZADO',
        numeroAutorizacion: '0711202601179001167400110010010000001231234567815',
        fechaAutorizacion: '2026-11-07T12:00:00-05:00',
        authorizedXml: '<autorizacion><estado>AUTORIZADO</estado></autorizacion>',
        mensajes: [],
        rawXml: '',
      }),
    };
    webhookMock = {
      dispatch: vi.fn().mockImplementation(async () => {
        callOrder.push('webhook:dispatch');
        return { delivered: true, statusCode: 200 };
      }),
    };

    consumer = new InvoiceQueueConsumer(
      prismaMock as never,
      aesGcmMock as never,
      xmlBuilderMock as never,
      xadesSignerMock as never,
      sriSoapMock as never,
      webhookMock as never,
    );

    // Speed up 2.5s delay in unit tests
    vi.spyOn(consumer as unknown as { delay: () => Promise<void> }, 'delay').mockResolvedValue();
  });

  it('should persist AUTORIZADO state and authorizedXml in DB before dispatching external webhook', async () => {
    const job = { data: mockJobData } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(callOrder).toEqual([
      'db:persist-authorized',
      'webhook:dispatch',
      'db:persist-webhook-status',
    ]);
  });

  it('should resolve active certificate from Certificate table, decrypt password, and sign XML with XAdES-BES', async () => {
    const job = { data: mockJobData } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(prismaMock.certificate.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(aesGcmMock.decrypt).toHaveBeenCalledWith(
      mockActiveCert.passwordCiphertext,
      mockActiveCert.passwordIv,
      mockActiveCert.passwordAuthTag,
    );

    expect(xadesSignerMock.signXml).toHaveBeenCalledWith(
      '<factura id="comprobante"/>',
      expect.any(Buffer),
      'decrypted-cert-password',
    );

    expect(sriSoapMock.validarComprobante).toHaveBeenCalled();
    expect(sriSoapMock.autorizacionComprobante).toHaveBeenCalled();
  });

  it('should fallback to parent ApiClient.webhookUrl when job.webhookUrl is empty or not provided', async () => {
    prismaMock.invoiceJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      tenantId: 'tenant-1',
      referenceId: 'INV-100',
      claveAcceso: '0711202601179001167400110010010000001231234567815',
      ambiente: '1',
      webhookUrl: '', // omitted at invoice level
      payloadJson: { ruc: '1790011674001' },
    });

    const job = { data: mockJobData } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(webhookMock.dispatch).toHaveBeenCalledWith(
      'https://api.saasplatform.com/sri-callback',
      expect.objectContaining({
        event: 'sri.invoice.completed',
        jobId: 'job-1',
        status: 'AUTORIZADO',
      }),
    );
  });

  it('should mark job as FAILED when no active certificate is found in Certificate table', async () => {
    prismaMock.certificate.findFirst.mockResolvedValueOnce(null);

    const job = { data: mockJobData } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(callOrder).toContain('db:persist-failed');
    expect(prismaMock.invoiceJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          sriMessages: expect.arrayContaining([
            expect.objectContaining({
              identificador: 'GATEWAY_ERROR',
            }),
          ]),
        }),
      }),
    );
  });

  it('should mark job as FAILED when certificate validity window has expired', async () => {
    prismaMock.certificate.findFirst.mockResolvedValueOnce({
      ...mockActiveCert,
      validTo: new Date(Date.now() - 10000), // expired
    });

    const job = { data: mockJobData } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(callOrder).toContain('db:persist-failed');
  });
});
