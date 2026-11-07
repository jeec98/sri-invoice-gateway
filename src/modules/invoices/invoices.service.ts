import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, Tenant } from '@prisma/client';
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

  async enqueueInvoice(tenant: Tenant, dto: CreateInvoiceDto) {
    if (tenant.ruc !== dto.ruc) {
      throw new ForbiddenException(
        `RUC_MISMATCH: El RUC del comprobante (${dto.ruc}) no coincide con el RUC del tenant autenticado (${tenant.ruc}).`,
      );
    }

    if (
      (!tenant.p12Binary && !tenant.p12FilePath) ||
      !tenant.passwordCiphertext ||
      !tenant.passwordIv ||
      !tenant.passwordAuthTag
    ) {
      throw new BadRequestException(
        'CERTIFICATE_NOT_CONFIGURED: El tenant aún no tiene un certificado electrónico (.p12) configurado. Suba uno en POST /v1/tenants/certificates.',
      );
    }

    // 1. Immediately generate the 49-digit Clave de Acceso (Modulo 11)
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

    // 2. Persist InvoiceJob record in PostgreSQL
    const invoiceJob = await this.prisma.invoiceJob.create({
      data: {
        tenantId: tenant.id,
        referenceId: dto.referenceId,
        claveAcceso,
        ambiente: dto.ambiente,
        status: 'QUEUED',
        webhookUrl: dto.webhookUrl,
        payloadJson: dto as unknown as Prisma.InputJsonValue,
      },
    });

    // 3. Enqueue background job in BullMQ
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
      claveAcceso,
      status: 'QUEUED',
    };
  }

  async getInvoiceByClaveAcceso(tenant: Tenant, claveAcceso: string) {
    const job = await this.prisma.invoiceJob.findFirst({
      where: {
        tenantId: tenant.id,
        claveAcceso,
      },
    });

    if (!job) {
      throw new NotFoundException(
        `INVOICE_NOT_FOUND: No se encontró un comprobante con clave de acceso ${claveAcceso}.`,
      );
    }

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
      authorizedXml: job.authorizedXml,
      webhookDelivered: job.webhookDelivered,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}

