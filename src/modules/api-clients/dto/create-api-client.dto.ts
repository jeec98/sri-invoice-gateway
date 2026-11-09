import { IsString, IsNotEmpty, IsOptional, IsUrl, IsInt, Min, Max, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiClientDto {
  @ApiProperty({ example: 'FacturaCloud SaaS', description: 'Nombre de la plataforma integradora' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    example: 'https://api.facturacloud.io/webhooks/sri',
    description: 'URL de webhook por defecto',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  webhookUrl?: string;

  @ApiPropertyOptional({
    example: 'STANDARD',
    enum: ['STANDARD', 'PRO', 'ENTERPRISE'],
    default: 'STANDARD',
  })
  @IsOptional()
  @IsIn(['STANDARD', 'PRO', 'ENTERPRISE'])
  plan?: string;

  @ApiPropertyOptional({
    example: 100,
    minimum: 1,
    maximum: 1000,
    default: 100,
    description: 'Límite de peticiones por segundo',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitRps?: number;
}
