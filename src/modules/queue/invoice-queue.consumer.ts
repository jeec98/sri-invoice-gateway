import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import * as fs from 'node:fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { XadesBesSignerService } from '../crypto/xades-bes-signer.service';
import { XmlBuilderService } from '../invoices/services/xml-builder.service';
import { CreateInvoiceDto } from '../invoices/dto/create-invoice.dto';
import { CreateRetentionDto } from '../invoices/dto/create-retention.dto';
import { SRI_INVOICE_QUEUE } from '../invoices/invoices.constants';
import {
  SriAutorizacionResult,
  SriMessage,
  SriSoapClientService,
} from '../sri-soap/sri-soap-client.service';
import { WebhookService } from '../webhook/webhook.service';

export interface InvoiceQueueJobData {
  invoiceJobId: string;
  tenantId: string;
  claveAcceso: string;
}

@Processor(SRI_INVOICE_QUEUE)
export class InvoiceQueueConsumer extends WorkerHost {
  private readonly logger = new Logger(InvoiceQueueConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aesGcm: AesGcmService,
    private readonly xmlBuilder: XmlBuilderService,
    private readonly xadesSigner: XadesBesSignerService,
    private readonly sriSoapClient: SriSoapClientService,
    private readonly webhookService: WebhookService,
  ) {
    super();
  }

  async process(job: Job<InvoiceQueueJobData>): Promise<void> {
    const { invoiceJobId, tenantId, claveAcceso } = job.data;
    this.logger.log(`Processing InvoiceJob ${invoiceJobId} [claveAcceso=${claveAcceso}]`);

    const invoiceJob = await this.prisma.invoiceJob.findUnique({
      where: { id: invoiceJobId },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { apiClient: true },
    });

    if (!invoiceJob || !tenant) {
      this.logger.error(`InvoiceJob ${invoiceJobId} or Tenant ${tenantId} not found.`);
      return;
    }

    // Resolve webhook destination: invoice level override or fallback to parent SaaS platform default
    const effectiveWebhookUrl = invoiceJob.webhookUrl || tenant.apiClient?.webhookUrl || '';

    await this.prisma.invoiceJob.update({
      where: { id: invoiceJobId },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
      },
    });

    let ephemeralP12Buffer: Buffer | null = null;

    try {
      // 1. Resolve active certificate from Certificate table
      const activeCert = await this.prisma.certificate.findFirst({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeCert) {
        throw new Error(
          `MISSING_ACTIVE_CERTIFICATE: No se encontró un certificado digital activo para el tenant ${tenantId}.`,
        );
      }

      const now = new Date();
      if (activeCert.validFrom > now || activeCert.validTo < now) {
        throw new Error(
          `CERTIFICATE_EXPIRED: El certificado digital del tenant ${tenantId} ha expirado o aún no entra en vigencia.`,
        );
      }

      // 2. Load .p12 binary and decrypt password with AES-256-GCM in ephemeral scope
      ephemeralP12Buffer = await this.loadTenantP12Buffer(
        activeCert.p12Binary,
        activeCert.p12FilePath,
      );

      if (!activeCert.passwordCiphertext || !activeCert.passwordIv || !activeCert.passwordAuthTag) {
        throw new Error('Credenciales AES-256-GCM del certificado incompletas para el tenant.');
      }

      const certPassword = this.aesGcm.decrypt(
        activeCert.passwordCiphertext,
        activeCert.passwordIv,
        activeCert.passwordAuthTag,
      );

      // 3. Build canonical unsigned XML with pre-calculated 49-digit Clave de Acceso
      const unsignedXml =
        invoiceJob.codDoc === '07'
          ? this.xmlBuilder.buildRetencionXml(
            invoiceJob.payloadJson as unknown as CreateRetentionDto,
            claveAcceso,
          )
          : this.xmlBuilder.buildFacturaXml(
            invoiceJob.payloadJson as unknown as CreateInvoiceDto,
            claveAcceso,
            tenant.apiClient?.ruc,
          );

      // 4. Sign XML with XAdES-BES engine using ephemeral credentials
      const signedXml = this.xadesSigner.signXml(unsignedXml, ephemeralP12Buffer, certPassword);

      // Ephemeral cleanup: wipe in-memory buffer immediately after signing
      if (ephemeralP12Buffer) {
        ephemeralP12Buffer.fill(0);
        ephemeralP12Buffer = null;
      }

      await this.prisma.invoiceJob.update({
        where: { id: invoiceJobId },
        data: {
          unsignedXml,
          signedXml,
        },
      });

      // 5. Send signed XML to SRI SOAP Recepción (validarComprobante)
      const recepcionResult = await this.sriSoapClient.validarComprobante(
        signedXml,
        invoiceJob.ambiente,
      );

      if (recepcionResult.estado !== 'RECIBIDA') {
        // DEVUELTA
        await this.finalizeAndNotify({
          invoiceJobId,
          referenceId: invoiceJob.referenceId,
          claveAcceso,
          ambiente: invoiceJob.ambiente,
          webhookUrl: effectiveWebhookUrl,
          status: 'DEVUELTA',
          sriMessages: recepcionResult.mensajes,
        });
        return;
      }

      await this.prisma.invoiceJob.update({
        where: { id: invoiceJobId },
        data: { status: 'RECIBIDA' },
      });

      // 6. Wait 2.5 seconds initial delay before querying SRI SOAP Autorización
      await this.delay(2500);

      // Query Authorization with up to 3 exponential backoff retries if state is 'EN PROCESO'
      let authResult: SriAutorizacionResult = await this.sriSoapClient.autorizacionComprobante(
        claveAcceso,
        invoiceJob.ambiente,
      );

      const maxRetries = 3;
      let retryCount = 0;

      while (authResult.estado === 'EN PROCESO' && retryCount < maxRetries) {
        retryCount++;
        const backoffMs = 2000 * Math.pow(2, retryCount - 1); // 2000ms, 4000ms, 8000ms
        this.logger.warn(
          `Clave ${claveAcceso} EN PROCESO. Retry ${retryCount}/${maxRetries} in ${backoffMs}ms...`,
        );
        await this.delay(backoffMs);
        authResult = await this.sriSoapClient.autorizacionComprobante(
          claveAcceso,
          invoiceJob.ambiente,
        );
      }

      if (authResult.estado === 'AUTORIZADO') {
        await this.finalizeAndNotify({
          invoiceJobId,
          referenceId: invoiceJob.referenceId,
          claveAcceso,
          ambiente: invoiceJob.ambiente,
          webhookUrl: effectiveWebhookUrl,
          status: 'AUTORIZADO',
          numeroAutorizacion: authResult.numeroAutorizacion || claveAcceso,
          fechaAutorizacion: authResult.fechaAutorizacion,
          authorizedXml: authResult.authorizedXml || authResult.comprobanteXml,
          sriMessages: authResult.mensajes,
        });
        return;
      }

      const finalStatus = authResult.estado === 'EN PROCESO' ? 'EN_PROCESO' : 'NO_AUTORIZADO';

      await this.finalizeAndNotify({
        invoiceJobId,
        referenceId: invoiceJob.referenceId,
        claveAcceso,
        ambiente: invoiceJob.ambiente,
        webhookUrl: effectiveWebhookUrl,
        status: finalStatus,
        numeroAutorizacion: authResult.numeroAutorizacion,
        fechaAutorizacion: authResult.fechaAutorizacion,
        sriMessages: authResult.mensajes,
      });
    } catch (error: unknown) {
      // Ensure any lingering ephemeral buffer is wiped on error
      if (ephemeralP12Buffer) {
        ephemeralP12Buffer.fill(0);
        ephemeralP12Buffer = null;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error processing InvoiceJob ${invoiceJobId} [claveAcceso=${claveAcceso}]: ${errMsg}`,
      );

      const failureMessages: SriMessage[] = [
        {
          identificador: 'GATEWAY_ERROR',
          mensaje: errMsg,
          tipo: 'ERROR',
        },
      ];

      await this.finalizeAndNotify({
        invoiceJobId,
        referenceId: invoiceJob?.referenceId || '',
        claveAcceso,
        ambiente: invoiceJob?.ambiente || '1',
        webhookUrl: effectiveWebhookUrl,
        status: 'FAILED',
        sriMessages: failureMessages,
      });
    }
  }

  private async finalizeAndNotify(params: {
    invoiceJobId: string;
    referenceId: string;
    claveAcceso: string;
    ambiente: string;
    webhookUrl: string;
    status: 'AUTORIZADO' | 'NO_AUTORIZADO' | 'DEVUELTA' | 'EN_PROCESO' | 'FAILED';
    numeroAutorizacion?: string;
    fechaAutorizacion?: string;
    authorizedXml?: string;
    sriMessages: SriMessage[];
  }): Promise<void> {
    const parsedFechaAuth = params.fechaAutorizacion
      ? new Date(params.fechaAutorizacion)
      : undefined;
    const validFechaAuth =
      parsedFechaAuth && !isNaN(parsedFechaAuth.getTime()) ? parsedFechaAuth : undefined;

    // 1. Persist final SRI outcome before dispatching external webhook to prevent race conditions or data loss
    await this.prisma.invoiceJob.update({
      where: { id: params.invoiceJobId },
      data: {
        status: params.status,
        numeroAutorizacion: params.numeroAutorizacion,
        fechaAutorizacion: validFechaAuth,
        authorizedXml: params.authorizedXml,
        sriMessages: params.sriMessages as unknown as Prisma.InputJsonValue,
      },
    });

    // 2. Dispatch webhook notification to tenant SaaS if webhookUrl is present
    if (params.webhookUrl) {
      const webhookResult = await this.webhookService.dispatch(params.webhookUrl, {
        event: 'sri.invoice.completed',
        jobId: params.invoiceJobId,
        referenceId: params.referenceId,
        claveAcceso: params.claveAcceso,
        ambiente: params.ambiente,
        status: params.status,
        numeroAutorizacion: params.numeroAutorizacion || null,
        fechaAutorizacion: params.fechaAutorizacion || null,
        authorizedXml: params.authorizedXml || null,
        sriMessages: params.sriMessages,
        timestamp: new Date().toISOString(),
      });

      // 3. Record webhook delivery outcome
      await this.prisma.invoiceJob.update({
        where: { id: params.invoiceJobId },
        data: {
          webhookDelivered: webhookResult.delivered,
          webhookResponseStatus: webhookResult.statusCode,
        },
      });
    }
  }

  private async loadTenantP12Buffer(
    p12Binary: Uint8Array | null,
    p12FilePath: string | null,
  ): Promise<Buffer> {
    if (p12Binary && p12Binary.byteLength > 0) {
      return this.aesGcm.decryptBuffer(Buffer.from(p12Binary));
    }
    if (p12FilePath) {
      const encryptedFile = await fs.readFile(p12FilePath);
      return this.aesGcm.decryptBuffer(encryptedFile);
    }
    throw new Error('No se encontró el binario del certificado .p12 para el tenant.');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
