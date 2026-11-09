import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Job } from 'bullmq';
import { InvoiceQueueConsumer, InvoiceQueueJobData } from './invoice-queue.consumer';

describe('InvoiceQueueConsumer', () => {
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
  };
  let webhookMock: {
    dispatch: ReturnType<typeof vi.fn>;
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
          webhookUrl: 'https://saas.example.com/webhook',
          payloadJson: {},
        }),
        update: vi.fn().mockImplementation(async ({ data }) => {
          if (data.status === 'AUTORIZADO') {
            callOrder.push('db:persist-authorized');
          } else if (data.webhookDelivered !== undefined) {
            callOrder.push('db:persist-webhook-status');
          }
          return {};
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tenant-1',
          p12Binary: Buffer.from('mock-p12'),
          p12FilePath: null,
          passwordCiphertext: 'cipher',
          passwordIv: 'iv',
          passwordAuthTag: 'tag',
        }),
      },
    };

    const aesGcmMock = {
      decrypt: vi.fn().mockReturnValue('cert-password'),
      decryptBuffer: vi.fn().mockImplementation((buf: Buffer) => buf),
    };
    const xmlBuilderMock = {
      buildFacturaXml: vi.fn().mockReturnValue('<factura id="comprobante"/>'),
    };
    const xadesSignerMock = {
      signXml: vi.fn().mockReturnValue('<factura id="comprobante"><ds:Signature/></factura>'),
    };
    const sriSoapMock = {
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
    const job = {
      data: {
        invoiceJobId: 'job-1',
        tenantId: 'tenant-1',
        claveAcceso: '0711202601179001167400110010010000001231234567815',
      },
    } as Job<InvoiceQueueJobData>;

    await consumer.process(job);

    expect(callOrder).toEqual([
      'db:persist-authorized',
      'webhook:dispatch',
      'db:persist-webhook-status',
    ]);
  });
});
