import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiClient } from '@prisma/client';
import { ApiKeyGuard } from '../tenants/guards/api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { CurrentApiClient } from '../api-clients/decorators/current-client.decorator';
import { DiagnosticsService } from './diagnostics.service';
import { VerifySetupDto } from './dto/verify-setup.dto';
import { DiagnosticResponseDto, TenantEligibilitySummaryDto } from './dto/diagnostic-response.dto';

@ApiTags('Diagnostics & SRI Health')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller()
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Post('diagnostics/verify-setup')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('p12File', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    }),
  )
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({
    summary:
      'Diagnóstico de Pre-vuelo Stateless: RUC, Firma .p12, Establecimientos y Conectividad SRI en memoria (<500ms)',
    description:
      'Valida matemáticamente el RUC (Módulo 10/11), inspecciona el archivo .p12 sin guardarlo en disco ni BD (contraseña, par RSA, vigencia, CA ARCOTEL, coincidencia RUC), audita la matriz de establecimientos y realiza un ping SOAP a los servidores del SRI. Devuelve un semáforo global (READY | DEGRADED | FAILED) y la bandera canIssueInvoices.',
  })
  @ApiResponse({
    status: 200,
    description: 'Diagnóstico completado exitosamente',
    type: DiagnosticResponseDto,
  })
  async verifySetup(
    @Body() dto: VerifySetupDto,
    @UploadedFile() p12File?: Express.Multer.File,
  ): Promise<DiagnosticResponseDto> {
    const fileBuffer = p12File?.buffer;
    return this.diagnosticsService.verifySetup(dto, fileBuffer);
  }

  @Get('tenants/:tenantId/diagnostics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Diagnóstico Integral Stateful de un Tenant Registrado',
    description:
      'Recupera las credenciales del tenant de la base de datos, descifra su certificado digital activo en memoria y ejecuta la auditoría completa de RUC, vigencia, revocación y conectividad con el SRI.',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'UUID del Tenant emisor registrado',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Diagnóstico del tenant completado',
    type: DiagnosticResponseDto,
  })
  async diagnoseTenant(
    @Param('tenantId') tenantId: string,
    @CurrentApiClient() apiClient: ApiClient,
  ): Promise<DiagnosticResponseDto> {
    return this.diagnosticsService.diagnoseTenant(tenantId, apiClient.id);
  }

  @Get('tenants/:tenantId/eligibility')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consulta Ligera de Elegibilidad de Emisión del Tenant',
    description:
      'Endpoint rápido que devuelve un resumen ejecutivo de si el tenant puede emitir comprobantes (canIssueInvoices: boolean), semáforo técnico y lista de motivos bloqueantes.',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'UUID del Tenant emisor registrado',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen ejecutivo de elegibilidad',
    type: TenantEligibilitySummaryDto,
  })
  async getTenantEligibility(
    @Param('tenantId') tenantId: string,
    @CurrentApiClient() apiClient: ApiClient,
  ): Promise<TenantEligibilitySummaryDto> {
    return this.diagnosticsService.getTenantEligibility(tenantId, apiClient.id);
  }
}
