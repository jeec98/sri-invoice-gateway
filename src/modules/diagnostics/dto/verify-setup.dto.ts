import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EstablishmentInputDto {
  @ApiProperty({
    description: 'Código de 3 dígitos del establecimiento (ej. "001", "002")',
    example: '001',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}$/, {
    message: 'El código de establecimiento debe tener exactamente 3 dígitos numéricos.',
  })
  codigo!: string;

  @ApiProperty({
    description: 'Código de 3 dígitos del punto de emisión (ej. "001", "002")',
    example: '001',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}$/, {
    message: 'El punto de emisión debe tener exactamente 3 dígitos numéricos.',
  })
  puntoEmision!: string;

  @ApiPropertyOptional({
    description: 'Nombre comercial o descripción del establecimiento',
    example: 'Matriz - Centro Histórico',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Dirección física del establecimiento',
    example: 'Av. Amazonas N24-196 y Luis Cordero',
  })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({
    description:
      'Estado operativo declarado por el usuario (true = abierto/activo, false = cerrado)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class VerifySetupDto {
  @ApiProperty({
    description: 'Número de RUC ecuatoriano de 13 dígitos numéricos',
    example: '1792147820001',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{13}$/, {
    message: 'El RUC debe tener exactamente 13 dígitos numéricos.',
  })
  ruc!: string;

  @ApiPropertyOptional({
    description:
      'Contenido del archivo .p12 codificado en Base64 (opcional si se envía vía multipart)',
    example: 'MIIJyQIBAzCCCU8GCSqGSIb3DQEHAaCCCU...',
  })
  @IsOptional()
  @IsString()
  p12Base64?: string;

  @ApiProperty({
    description: 'Contraseña del archivo de firma electrónica PKCS#12 (.p12/.pfx)',
    example: 'MiFirmaSegura2026*',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional({
    description: 'Ambiente objetivo del SRI (1 = Pruebas, 2 = Producción)',
    example: '1',
    default: '1',
  })
  @IsOptional()
  @IsIn(['1', '2'], {
    message: 'El ambiente debe ser "1" (Pruebas) o "2" (Producción).',
  })
  ambiente?: '1' | '2';

  @ApiPropertyOptional({
    description: 'Lista de establecimientos y puntos de emisión a diagnosticar',
    type: [EstablishmentInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EstablishmentInputDto)
  establishments?: EstablishmentInputDto[];
}
