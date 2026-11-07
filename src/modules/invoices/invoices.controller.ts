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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { ApiKeyGuard } from '../tenants/guards/api-key.guard';
import { CurrentTenant } from '../tenants/decorators/current-tenant.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Generar Clave de Acceso (49 dígitos) y encolar factura para firma XAdES-BES y autorización asíncrona en el SRI (<200ms)',
  })
  @ApiResponse({
    status: 202,
    description: 'Factura encolada exitosamente en BullMQ',
  })
  async createInvoice(@CurrentTenant() tenant: Tenant, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.enqueueInvoice(tenant, dto);
  }

  @Get(':claveAcceso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar el estado actual y XML autorizado de una factura por su Clave de Acceso',
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
