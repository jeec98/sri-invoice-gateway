import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiClientsService, ApiClientWithRawKey } from './api-clients.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';

@ApiTags('API Clients')
@Controller('api-clients')
export class ApiClientsController {
  constructor(private readonly apiClientsService: ApiClientsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Provisionar plataforma SaaS (ApiClient)',
    description:
      'Registra un nuevo integrador SaaS, genera una API Key maestra (sri_live_<48_hex>) y persiste su hash SHA-256. Retorna la API Key en texto plano una única vez.',
  })
  @ApiResponse({
    status: 201,
    description: 'Plataforma SaaS aprovisionada exitosamente. Contiene la API Key generada.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Parámetros de entrada inválidos (URL malformada, RUC inválido, rateLimitRps no positivo).',
  })
  @ApiResponse({
    status: 409,
    description: 'API_CLIENT_RUC_EXISTS: Ya existe una plataforma SaaS registrada con este RUC.',
  })
  async create(@Body() dto: CreateApiClientDto): Promise<ApiClientWithRawKey> {
    return this.apiClientsService.create(dto);
  }
}
