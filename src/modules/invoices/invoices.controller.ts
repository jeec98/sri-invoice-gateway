import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiClient, Tenant } from '@prisma/client';
import { ApiKeyGuard } from '../tenants/guards/api-key.guard';
import { TenantAccessGuard } from '../tenants/guards/tenant-access.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { CurrentTenant } from '../tenants/decorators/current-tenant.decorator';
import { CurrentApiClient } from '../api-clients/decorators/current-client.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard, TenantAccessGuard)
@Controller('tenants/:tenantId/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Generar Clave de Acceso (49 dígitos) y encolar factura para firma XAdES-BES y autorización asíncrona en el SRI (<200ms)',
    description:
      'Valida certificado activo del tenant, verifica invariante de RUC (tenant.ruc === dto.ruc), persiste el trabajo con estado QUEUED y lo encola en BullMQ.',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'UUID del Tenant (Empresa Emisora) perteneciente a la plataforma SaaS autenticada',
    type: String,
  })
  @ApiResponse({
    status: 202,
    description: 'Factura aceptada y encolada exitosamente en BullMQ',
  })
  @ApiResponse({
    status: 400,
    description: 'Tenant sin certificado digital activo o certificado inválido/expirado',
  })
  @ApiResponse({
    status: 403,
    description:
      'RUC_MISMATCH: El RUC del emisor no coincide con el RUC del tenant, o TENANT_ACCESS_DENIED',
  })
  @ApiResponse({
    status: 409,
    description:
      'DUPLICATE_REFERENCE_ID: Ya existe un comprobante con ese referenceId para este tenant',
  })
  async createInvoice(
    @CurrentTenant() tenant: Tenant,
    @CurrentApiClient() apiClient: ApiClient,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.createInvoice(tenant, dto, apiClient);
  }

  @Get(':claveAcceso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar el estado actual y XML autorizado de una factura por su Clave de Acceso',
    description:
      'Búsqueda acotada estrictamente al tenant autenticado (WHERE clave_acceso = :claveAcceso AND tenant_id = :tenantId).',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'UUID del Tenant propietario del comprobante',
    type: String,
  })
  @ApiParam({
    name: 'claveAcceso',
    description: 'Clave de Acceso de 49 dígitos numéricos generada para el comprobante',
    type: String,
    example: '0711202601179001167400110010010000001237602192712',
  })
  @ApiResponse({
    status: 200,
    description: 'Estado y detalles del comprobante electrónico',
  })
  @ApiResponse({
    status: 400,
    description:
      'INVALID_CLAVE_ACCESO: La clave de acceso debe contener exactamente 49 dígitos numéricos',
  })
  @ApiResponse({
    status: 404,
    description: 'INVOICE_NOT_FOUND: Comprobante no encontrado bajo este tenant',
  })
  async getInvoiceStatus(
    @CurrentTenant() tenant: Tenant,
    @Param('claveAcceso') claveAcceso: string,
  ) {
    if (!/^\d{49}$/.test(claveAcceso)) {
      throw new BadRequestException(
        'INVALID_CLAVE_ACCESO: La clave de acceso debe contener exactamente 49 dígitos numéricos.',
      );
    }
    return this.invoicesService.getInvoiceByClaveAcceso(tenant, claveAcceso);
  }
}
