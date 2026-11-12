import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiClient, Tenant } from '@prisma/client';
import { ApiKeyGuard } from '../tenants/guards/api-key.guard';
import { TenantAccessGuard } from '../tenants/guards/tenant-access.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { CurrentTenant } from '../tenants/decorators/current-tenant.decorator';
import { CurrentApiClient } from '../api-clients/decorators/current-client.decorator';
import { CreateRetentionDto } from './dto/create-retention.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Retentions')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard, TenantAccessGuard)
@Controller('tenants/:tenantId/retentions')
export class RetentionsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Generar Clave de Acceso (49 dígitos, codDoc=07) y encolar Comprobante de Retención v2.0.0 para firma XAdES-BES y envío al SRI',
  })
  @ApiParam({ name: 'tenantId', description: 'UUID del Tenant emisor', type: String })
  @ApiResponse({ status: 202, description: 'Comprobante de retención encolado en BullMQ' })
  async createRetention(
    @CurrentTenant() tenant: Tenant,
    @CurrentApiClient() apiClient: ApiClient,
    @Body() dto: CreateRetentionDto,
  ) {
    return this.invoicesService.createRetention(tenant, dto, apiClient);
  }
}

