import {
  BadRequestException,
  ConflictException,
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
import { PROCESS_INVOICE_JOB, SRI_INVOICE_QUEUE } from './invoices.constants';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessKeyService: AccessKeyService,
    @InjectQueue(SRI_INVOICE_QUEUE) private readonly invoiceQueue: Queue,
  ) {}

  async createInvoice(tenant: Tenant, dto: CreateInvoiceDto, apiClient?: ApiClient | null) {
    // 1. Check for active digital certificate in Certificate table
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

    // 2. Enforce Taxpayer Invariant: tenant.ruc === dto.ruc
    if (tenant.ruc !== dto.ruc) {
      throw new ForbiddenException(
        `RUC_MISMATCH: El RUC del emisor en el payload (${dto.ruc}) no coincide con el RUC del tenant (${tenant.ruc}).`,
      );
    }

    // 3. Guard against duplicate referenceId for the same tenant (Idempotency)
    const existingJob = await this.prisma.invoiceJob.findFirst({
      where: {
        tenantId: tenant.id,
        referenceId: dto.referenceId,
      },
    });

    if (existingJob) {
      throw new ConflictException(
        `DUPLICATE_REFERENCE_ID: Ya existe un comprobante registrado con referenceId "${dto.referenceId}" (claveAcceso: ${existingJob.claveAcceso}).`,
      );
    }

    // 4. Immediately generate the 49-digit Clave de Acceso (Modulo 11)
    const claveAcceso = this.accessKeyService.generateAccessKey({
      fechaEmision: dto.fechaEmision,
      codDoc: '01',
      ruc: dto.ruc,
      ambiente: dto.ambiente,
      estab: dto.estab,
      ptoEmi: dto.ptoEmi,
      secuencial: dto.secuencial,
      tipoEmision: '1',
    });

    // 5. Resolve webhook destination (DTO override or fallback to SaaS platform default)
    const resolvedWebhookUrl = dto.webhookUrl || apiClient?.webhookUrl || '';

    // 6. Persist InvoiceJob record in PostgreSQL with status 'QUEUED'
    const invoiceJob = await this.prisma.invoiceJob.create({
      data: {
        tenantId: tenant.id,
        referenceId: dto.referenceId,
        claveAcceso,
        ambiente: dto.ambiente,
        status: 'QUEUED',
        webhookUrl: resolvedWebhookUrl,
        payloadJson: dto as unknown as Prisma.InputJsonValue,
      },
    });

    // 7. Enqueue background job in BullMQ
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

    return {
      success: true,
      jobId: String(bullJob.id || invoiceJob.id),
      referenceId: invoiceJob.referenceId,
      claveAcceso,
      status: 'QUEUED',
    };
  }

  async enqueueInvoice(tenant: Tenant, dto: CreateInvoiceDto, apiClient?: ApiClient | null) {
    return this.createInvoice(tenant, dto, apiClient);
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
