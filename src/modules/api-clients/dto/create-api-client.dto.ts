import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsInt,
  Min,
  Max,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiClientDto {
  @ApiProperty({ example: 'FacturaCloud SaaS', description: 'Nombre de la plataforma integradora' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: '1790011674001',
    description:
      'RUC de 13 dígitos del proveedor de software/SaaS (terminado en 001). Se incluye automáticamente en <campoAdicional nombre="RUC Proveedor"> del XML (Resolución NAC-DGERCGC26-00000027).',
  })
  @IsString()
  @IsNotEmpty({ message: 'El RUC del proveedor SaaS (ruc) es obligatorio.' })
  @Length(13, 13, { message: 'El RUC debe tener exactamente 13 dígitos.' })
  @Matches(/^\d{10}001$/, {
    message: 'El RUC debe tener 13 dígitos numéricos y terminar en 001.',
  })
  ruc!: string;

  @ApiPropertyOptional({
    example: 'https://api.facturacloud.io/webhooks/sri',
    description: 'URL de webhook por defecto para notificaciones asíncronas del SRI',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  webhookUrl?: string;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Límite opcional de peticiones por segundo (por defecto 20 req/s)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  rateLimitRps?: number;
}
