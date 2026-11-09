import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiClient, Tenant } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UploadCertificateDto } from './dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { TenantAccessGuard } from './guards/tenant-access.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { CurrentApiClient } from '../api-clients/decorators/current-client.decorator';
import { CurrentTenant } from './decorators/current-tenant.decorator';

@ApiTags('Tenants & Certificates')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UseGuards(ApiKeyGuard, RateLimitGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar una nueva Empresa Emisora (Tenant) bajo la plataforma SaaS autenticada',
  })
  async registerTenant(@CurrentApiClient() apiClient: ApiClient, @Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(apiClient.id, dto);
  }

  @Get()
  @UseGuards(ApiKeyGuard, RateLimitGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Listar empresas emisoras (Tenants) pertenecientes estrictamente a la plataforma SaaS autenticada',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  async listTenants(
    @CurrentApiClient() apiClient: ApiClient,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.tenantsService.listTenants(apiClient.id, { page, limit });
  }

  @Post(':tenantId/certificates')
  @UseGuards(ApiKeyGuard, RateLimitGuard, TenantAccessGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max for .p12/.pfx
    }),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Subir y validar certificado .p12/.pfx (CA acreditada, RUC, vigencia, integridad y revocación), cifrando con AES-256-GCM',
  })
  async uploadCertificate(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: UploadCertificateDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException(
        'MISSING_FILE: Debe enviar el archivo .p12/.pfx en el campo multipart "file".',
      );
    }

    return this.tenantsService.uploadCertificate(tenant, dto, file.buffer, file.originalname);
  }
}
