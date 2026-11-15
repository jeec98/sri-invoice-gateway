import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiClient, InvoiceJob, Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessKeyService } from './services/access-key.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateRetentionDto } from './dto/create-retention.dto';
import { PROCESS_INVOICE_JOB, SRI_INVOICE_QUEUE } from './invoices.constants';

export interface EnqueueDocumentResult {
  success: boolean;
  isNew: boolean;
  isRetry: boolean;
  jobId: string;
  referenceId: string;
  claveAcceso: string;
  ambiente?: string;
  status: string;
  numeroAutorizacion?: string | null;
  fechaAutorizacion?: Date | null;
  sriMessages?: unknown;
  signedXml?: string | null;
  authorizedXml?: string | null;
  webhookDelivered?: boolean;
  webhookResponseStatus?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessKeyService: AccessKeyService,
    @InjectQueue(SRI_INVOICE_QUEUE) private readonly invoiceQueue: Queue,
  ) {}

  async createInvoice(tenant: Tenant, dto: CreateInvoiceDto, apiClient?: ApiClient | null) {
    return this.enqueueElectronicDocument(tenant, dto, '01', apiClient);
  }

  async enqueueInvoice(tenant: Tenant, dto: CreateInvoiceDto, apiClient?: ApiClient | null) {
    return this.createInvoice(tenant, dto, apiClient);
  }

  async createRetention(tenant: Tenant, dto: CreateRetentionDto, apiClient?: ApiClient | null) {
    return this.enqueueElectronicDocument(tenant, dto, '07', apiClient);
  }

  private async enqueueElectronicDocument(
    tenant: Tenant,
    dto: CreateInvoiceDto | CreateRetentionDto,
    codDoc: '01' | '07',
    apiClient?: ApiClient | null,
  ) {
    const activeCert = await this.prisma.certificate.findFirst({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeCert) {
      throw new BadRequestException(
        'MISSING_ACTIVE_CERTIFICATE: El tenant no cuenta con un certificado digital activo para firmar comprobantes.',
      );
    }

    const now = new Date();
    if (activeCert.validFrom > now || activeCert.validTo < now) {
      throw new BadRequestException(
        'MISSING_ACTIVE_CERTIFICATE: El certificado digital del tenant ha expirado o aún no entra en vigencia.',
      );
    }

    if (tenant.ruc !== dto.ruc) {
      throw new ForbiddenException(
        `RUC_MISMATCH: El RUC del emisor en el payload (${dto.ruc}) no coincide con el RUC del tenant (${tenant.ruc}).`,
      );
    }

    const existingJob = await this.prisma.invoiceJob.findFirst({
      where: {
        tenantId: tenant.id,
        referenceId: dto.referenceId,
      },
    });

    if (existingJob) {
      if (existingJob.status !== 'FAILED') {
        return this.mapToEnqueueResult(existingJob, {
          isNew: false,
          isRetry: false,
        });
      }

      const resolvedWebhookUrl =
        dto.webhookUrl || apiClient?.webhookUrl || existingJob.webhookUrl || '';

      const updatedJob = await this.prisma.invoiceJob.update({
        where: { id: existingJob.id },
        data: {
          status: 'QUEUED',
          attempts: 0,
          sriMessages: Prisma.DbNull,
          webhookUrl: resolvedWebhookUrl,
          payloadJson: dto as unknown as Prisma.InputJsonValue,
        },
      });

      const retryJobId = `${existingJob.id}-retry-${Date.now()}`;
      const bullJob = await this.invoiceQueue.add(
        PROCESS_INVOICE_JOB,
        {
          invoiceJobId: existingJob.id,
          tenantId: tenant.id,
          claveAcceso: existingJob.claveAcceso,
        },
        {
          jobId: retryJobId,
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );

      return this.mapToEnqueueResult(updatedJob, {
        isNew: false,
        isRetry: true,
        queueJobId: String(bullJob?.id || retryJobId),
      });
    }

    const claveAcceso = this.accessKeyService.generateAccessKey({
      fechaEmision: dto.fechaEmision,
      codDoc,
      ruc: dto.ruc,
      ambiente: dto.ambiente,
      estab: dto.estab,
      ptoEmi: dto.ptoEmi,
      secuencial: dto.secuencial,
      tipoEmision: '1',
    });

    const resolvedWebhookUrl = dto.webhookUrl || apiClient?.webhookUrl || '';

    const invoiceJob = await this.prisma.invoiceJob.create({
      data: {
        tenantId: tenant.id,
        referenceId: dto.referenceId,
        codDoc,
        claveAcceso,
        ambiente: dto.ambiente,
        status: 'QUEUED',
        webhookUrl: resolvedWebhookUrl,
        payloadJson: dto as unknown as Prisma.InputJsonValue,
      },
    });

    const bullJob = await this.invoiceQueue.add(
      PROCESS_INVOICE_JOB,
      {
        invoiceJobId: invoiceJob.id,
        tenantId: tenant.id,
        claveAcceso,
      },
      {
        jobId: invoiceJob.id,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return this.mapToEnqueueResult(invoiceJob, {
      isNew: true,
      isRetry: false,
      queueJobId: String(bullJob?.id || invoiceJob.id),
    });
  }

  private mapToEnqueueResult(
    job: InvoiceJob,
    options: { isNew: boolean; isRetry: boolean; queueJobId?: string },
  ): EnqueueDocumentResult {
    return {
      success: true,
      isNew: options.isNew,
      isRetry: options.isRetry,
      jobId: options.queueJobId || job.id,
      referenceId: job.referenceId,
      claveAcceso: job.claveAcceso,
      ambiente: job.ambiente,
      status: job.status,
      numeroAutorizacion: job.numeroAutorizacion,
      fechaAutorizacion: job.fechaAutorizacion,
      sriMessages: job.sriMessages,
      signedXml: job.signedXml,
      authorizedXml: job.authorizedXml,
      webhookDelivered: job.webhookDelivered,
      webhookResponseStatus: job.webhookResponseStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async getInvoiceByClaveAcceso(tenant: Tenant, claveAcceso: string) {
    if (!/^\d{49}$/.test(claveAcceso)) {
      throw new BadRequestException(
        'INVALID_CLAVE_ACCESO: La clave de acceso debe contener exactamente 49 dígitos numéricos.',
      );
    }

    const job = await this.prisma.invoiceJob.findFirst({
      where: {
        tenantId: tenant.id,
        claveAcceso,
      },
    });

    if (!job) {
      throw new NotFoundException(
        'INVOICE_NOT_FOUND: No se encontró la factura con la Clave de Acceso especificada para este tenant.',
      );
    }

    return this.formatInvoiceResponse(job);
  }

  private formatInvoiceResponse(job: InvoiceJob) {
    return {
      success: true,
      jobId: job.id,
      referenceId: job.referenceId,
      claveAcceso: job.claveAcceso,
      ambiente: job.ambiente,
      status: job.status,
      numeroAutorizacion: job.numeroAutorizacion,
      fechaAutorizacion: job.fechaAutorizacion,
      sriMessages: job.sriMessages,
      signedXml: job.signedXml,
      authorizedXml: job.authorizedXml,
      webhookDelivered: job.webhookDelivered,
      webhookResponseStatus: job.webhookResponseStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
