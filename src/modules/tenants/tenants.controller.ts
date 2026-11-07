import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UploadCertificateDto } from './dto/upload-certificate.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentTenant } from './decorators/current-tenant.decorator';

@ApiTags('Tenants & Certificates')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un nuevo Tenant y generar su API Key (persistida como SHA-256)',
  })
  async registerTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Post('certificates')
  @UseGuards(ApiKeyGuard)
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
      'Subir y validar archivo .p12/.pfx para el Tenant autenticado, cifrando la contraseña con AES-256-GCM',
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

    return this.tenantsService.uploadCertificate(
      tenant,
      dto,
      file.buffer,
      file.originalname,
    );
  }
}

