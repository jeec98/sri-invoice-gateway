import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RequestWithClient } from '../../common/types/request-with-context';
import { ApiKeyGuard } from '../tenants/guards/api-key.guard';
import { CatastroSyncGuard } from './guards/catastro-sync.guard';
import {
  TaxpayerProfileResponseDto,
  TriggerSyncDto,
  TriggerSyncResponseDto,
  WithholdingEligibilityDto,
  WithholdingEligibilityResponseDto,
} from './dto/taxpayer-profile.dto';
import { TaxpayersService } from './services/taxpayers.service';

@ApiTags('Taxpayers & SRI Catastro')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('taxpayers')
export class TaxpayersController {
  constructor(private readonly taxpayersService: TaxpayersService) {}

  @Get(':ruc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar perfil tributario SRI de un contribuyente por RUC',
    description:
      'Resuelve en cascada Redis (L1) -> Postgres Catastro Especial + Perfil (L2) -> Consulta en línea srienlinea (L3) con circuit breaker resiliente.',
  })
  @ApiParam({
    name: 'ruc',
    description: 'RUC ecuatoriano válido de 13 dígitos',
    example: '1790016919001',
  })
  @ApiQuery({
    name: 'refresh',
    required: false,
    type: Boolean,
    description:
      'Si es true, omite Redis L1/L2 y fuerza refresco desde SRI live (respetando circuit breaker).',
  })
  @ApiResponse({ status: 200, type: TaxpayerProfileResponseDto })
  @ApiResponse({ status: 400, description: 'RUC inválido según Módulo 10/11' })
  @ApiResponse({ status: 401, description: 'API Key inválida o ausente' })
  @ApiResponse({ status: 429, description: 'Límite de tasa por plataforma excedido' })
  async getTaxpayerByRuc(
    @Param('ruc') ruc: string,
    @Query('refresh') refresh?: string,
  ): Promise<TaxpayerProfileResponseDto> {
    return this.taxpayersService.getTaxpayerByRuc(ruc, refresh === 'true');
  }

  @Post('withholding-eligibility')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluar obligación de retención entre comprador y vendedor',
    description:
      'Aplica las reglas oficiales SRI (Agente de Retención, Contribuyente Especial, RIMPE Emprendedor, RIMPE Negocio Popular 332/0%, Liquidación de Compra 03).',
  })
  @ApiResponse({ status: 200, type: WithholdingEligibilityResponseDto })
  @ApiResponse({ status: 400, description: 'Payload inválido o RUC no válido' })
  @ApiResponse({ status: 401, description: 'API Key inválida o ausente' })
  @ApiResponse({ status: 429, description: 'Límite de tasa por plataforma excedido' })
  async evaluateWithholdingEligibility(
    @Body() dto: WithholdingEligibilityDto,
  ): Promise<WithholdingEligibilityResponseDto> {
    return this.taxpayersService.evaluateWithholdingEligibility(dto);
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CatastroSyncGuard)
  @ApiHeader({
    name: 'X-Internal-Key',
    required: false,
    description:
      'Clave interna/administrativa (SRI_INTERNAL_ADMIN_KEY) requerida en producción o cuando esté configurada para disparar sincronización manual.',
  })
  @ApiOperation({
    summary: 'Encolar sincronización asíncrona de catastro oficial SRI CKAN',
    description:
      'Encola un job deduplicado en BullMQ para sincronizar los catálogos oficiales SRI (Agentes de Retención, Contribuyentes Especiales, RIMPE). Protegido por privilegio interno/administrativo y cooldown anti-abuso.',
  })
  @ApiResponse({ status: 202, type: TriggerSyncResponseDto })
  @ApiResponse({ status: 400, description: 'Parámetros de sincronización inválidos' })
  @ApiResponse({ status: 401, description: 'API Key inválida o ausente' })
  @ApiResponse({ status: 403, description: 'Privilegio interno/administrativo requerido' })
  @ApiResponse({ status: 429, description: 'Límite de tasa o cooldown de sincronización activo' })
  async triggerSync(
    @Body() dto: TriggerSyncDto,
    @Req() req: RequestWithClient,
  ): Promise<TriggerSyncResponseDto> {
    return this.taxpayersService.triggerSync(dto, {
      isInternalAdmin: Boolean(req.isInternalAdmin),
    });
  }
}
