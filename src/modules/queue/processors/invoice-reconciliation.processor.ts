import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InvoiceJob, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DEFAULT_RECONCILIATION_BATCH_SIZE,
  DEFAULT_RECONCILIATION_THRESHOLD_SEC,
  RECONCILE_INVOICES_JOB,
  SRI_RECONCILIATION_QUEUE,
} from '../../invoices/invoices.constants';
import {
  SriAutorizacionResult,
  SriSoapClientService,
} from '../../sri-soap/sri-soap-client.service';
import { WebhookService } from '../../webhook/webhook.service';

@Processor(SRI_RECONCILIATION_QUEUE, {
  concurrency: 1,
})
export class InvoiceReconciliationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(InvoiceReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SRI_RECONCILIATION_QUEUE) private readonly reconciliationQueue: Queue,
    private readonly sriSoapClient: SriSoapClientService,
    private readonly webhookService: WebhookService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.SRI_RECONCILIATION_ENABLED === 'false') {
      return;
    }

    const pattern = process.env.SRI_RECONCILIATION_CRON || '* * * * *';
    try {
      await this.reconciliationQueue.upsertJobScheduler(
        'sri-invoice-reconciliation-job',
        { pattern },
        {
          name: RECONCILE_INVOICES_JOB,
          opts: {
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        },
      );
      this.logger.log(`Registered SRI Invoice Reconciliation scheduler (${pattern})`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register SRI Invoice Reconciliation scheduler: ${msg}`);
    }
  }

  async process(_job?: Job): Promise<void> {
    const candidates = await this.findStalePendingInvoices();
    if (candidates.length === 0) {
      return;
    }

    this.logger.log(
      `Starting reconciliation sweep for ${candidates.length} stale pending invoices...`,
    );

    for (const invoice of candidates) {
      await this.reconcileInvoice(invoice);
    }
  }

  private async findStalePendingInvoices(): Promise<InvoiceJob[]> {
    const thresholdSec = Number(
      process.env.SRI_RECONCILIATION_THRESHOLD_SEC || DEFAULT_RECONCILIATION_THRESHOLD_SEC,
    );
    const batchSize = Number(
      process.env.SRI_RECONCILIATION_BATCH_SIZE || DEFAULT_RECONCILIATION_BATCH_SIZE,
    );
    const thresholdDate = new Date(Date.now() - thresholdSec * 1000);

    return this.prisma.invoiceJob.findMany({
      where: {
        status: { in: ['EN_PROCESO', 'RECIBIDA'] },
        updatedAt: { lte: thresholdDate },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
  }

  private async reconcileInvoice(invoice: InvoiceJob): Promise<void> {
    try {
      const authResult: SriAutorizacionResult = await this.sriSoapClient.autorizacionComprobante(
        invoice.claveAcceso,
        invoice.ambiente,
      );

      if (authResult.estado === 'AUTORIZADO') {
        const parsedFechaAuth = authResult.fechaAutorizacion
          ? new Date(authResult.fechaAutorizacion)
          : undefined;
        const validFechaAuth =
          parsedFechaAuth && !isNaN(parsedFechaAuth.getTime()) ? parsedFechaAuth : undefined;

        await this.prisma.invoiceJob.update({
          where: { id: invoice.id },
          data: {
            status: 'AUTORIZADO',
            numeroAutorizacion: authResult.numeroAutorizacion || invoice.claveAcceso,
            fechaAutorizacion: validFechaAuth,
            authorizedXml: authResult.authorizedXml || authResult.comprobanteXml,
            sriMessages: authResult.mensajes as unknown as Prisma.InputJsonValue,
          },
        });

        if (invoice.webhookUrl) {
          const webhookResult = await this.webhookService.dispatch(invoice.webhookUrl, {
            event: 'sri.invoice.completed',
            jobId: invoice.id,
            referenceId: invoice.referenceId,
            claveAcceso: invoice.claveAcceso,
            ambiente: invoice.ambiente,
            status: 'AUTORIZADO',
            numeroAutorizacion: authResult.numeroAutorizacion || invoice.claveAcceso,
            fechaAutorizacion: authResult.fechaAutorizacion || null,
            authorizedXml: authResult.authorizedXml || authResult.comprobanteXml || null,
            sriMessages: authResult.mensajes,
            timestamp: new Date().toISOString(),
          });

          await this.prisma.invoiceJob.update({
            where: { id: invoice.id },
            data: {
              webhookDelivered: webhookResult.delivered,
              webhookResponseStatus: webhookResult.statusCode,
            },
          });
        }
        return;
      }

      if (authResult.estado === 'NO AUTORIZADO') {
        const parsedFechaAuth = authResult.fechaAutorizacion
          ? new Date(authResult.fechaAutorizacion)
          : undefined;
        const validFechaAuth =
          parsedFechaAuth && !isNaN(parsedFechaAuth.getTime()) ? parsedFechaAuth : undefined;

        await this.prisma.invoiceJob.update({
          where: { id: invoice.id },
          data: {
            status: 'NO_AUTORIZADO',
            numeroAutorizacion: authResult.numeroAutorizacion,
            fechaAutorizacion: validFechaAuth,
            sriMessages: authResult.mensajes as unknown as Prisma.InputJsonValue,
          },
        });

        if (invoice.webhookUrl) {
          const webhookResult = await this.webhookService.dispatch(invoice.webhookUrl, {
            event: 'sri.invoice.completed',
            jobId: invoice.id,
            referenceId: invoice.referenceId,
            claveAcceso: invoice.claveAcceso,
            ambiente: invoice.ambiente,
            status: 'NO_AUTORIZADO',
            numeroAutorizacion: authResult.numeroAutorizacion || null,
            fechaAutorizacion: authResult.fechaAutorizacion || null,
            authorizedXml: null,
            sriMessages: authResult.mensajes,
            timestamp: new Date().toISOString(),
          });

          await this.prisma.invoiceJob.update({
            where: { id: invoice.id },
            data: {
              webhookDelivered: webhookResult.delivered,
              webhookResponseStatus: webhookResult.statusCode,
            },
          });
        }
        return;
      }

      // If still EN PROCESO: touch updatedAt so it is excluded until next window, no webhook
      await this.prisma.invoiceJob.update({
        where: { id: invoice.id },
        data: {
          updatedAt: new Date(),
          sriMessages: authResult.mensajes as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to reconcile invoice ${invoice.id} [claveAcceso=${invoice.claveAcceso}]: ${errMsg}. Touching updatedAt for next cycle.`,
      );
      try {
        await this.prisma.invoiceJob.update({
          where: { id: invoice.id },
          data: {
            updatedAt: new Date(),
          },
        });
      } catch (touchError: unknown) {
        this.logger.error(
          `Could not touch updatedAt on invoice ${invoice.id}: ${touchError instanceof Error ? touchError.message : String(touchError)}`,
        );
      }
    }
  }
}
