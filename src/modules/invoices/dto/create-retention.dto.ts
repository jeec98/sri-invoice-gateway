import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetencionImpuestoSustentoDto {
  @ApiProperty({ example: '2', description: '2 = IVA' })
  @IsString()
  @IsNotEmpty()
  codImpuestoDocSustento: string;

  @ApiProperty({ example: '4', description: 'Código porcentaje IVA (0, 2, 4, 6, 7)' })
  @IsString()
  @IsNotEmpty()
  codigoPorcentaje: string;

  @ApiProperty({ example: 1000.0 })
  @IsNumber()
  @Min(0)
  baseImponible: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(0)
  tarifa: number;

  @ApiProperty({ example: 150.0 })
  @IsNumber()
  @Min(0)
  valorImpuesto: number;
}

export class RetencionItemDto {
  @ApiProperty({ enum: ['1', '2'], description: '1 = Renta, 2 = IVA' })
  @IsIn(['1', '2'])
  codigo: '1' | '2';

  @ApiProperty({ example: '312', description: 'Código de retención SRI' })
  @IsString()
  @IsNotEmpty()
  codigoRetencion: string;

  @ApiProperty({ example: 1000.0 })
  @IsNumber()
  @Min(0)
  baseImponible: number;

  @ApiProperty({ example: 2.0 })
  @IsNumber()
  @Min(0)
  porcentajeRetener: number;

  @ApiProperty({ example: 20.0 })
  @IsNumber()
  @Min(0)
  valorRetenido: number;
}

export class RetencionPagoSustentoDto {
  @ApiProperty({ example: '20' })
  @IsString()
  @IsNotEmpty()
  formaPago: string;

  @ApiProperty({ example: 1150.0 })
  @IsNumber()
  @Min(0)
  total: number;
}

export class DocSustentoDto {
  @ApiProperty({ example: '01', description: 'Código sustento tributario ATS' })
  @IsString()
  @IsNotEmpty()
  codSustento: string;

  @ApiProperty({ example: '01', description: 'Código doc sustento (01 = Factura)' })
  @IsString()
  @IsNotEmpty()
  codDocSustento: string;

  @ApiProperty({ example: '001002000045678', description: '15 dígitos sin guiones' })
  @IsString()
  @IsNotEmpty()
  numDocSustento: string;

  @ApiProperty({ example: '10/11/2026' })
  @IsString()
  @IsNotEmpty()
  fechaEmisionDocSustento: string;

  @ApiPropertyOptional({ example: '10/11/2026' })
  @IsOptional()
  @IsString()
  fechaRegistroContable?: string;

  @ApiPropertyOptional({ example: '1011202601179001691900120010020000456781234567819' })
  @IsOptional()
  @IsString()
  numAutDocSustento?: string;

  @ApiPropertyOptional({ example: '01' })
  @IsOptional()
  @IsString()
  pagoLocExt?: string;

  @ApiProperty({ example: 1000.0 })
  @IsNumber()
  @Min(0)
  totalSinImpuestos: number;

  @ApiProperty({ example: 1150.0 })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  @ApiProperty({ type: [RetencionImpuestoSustentoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RetencionImpuestoSustentoDto)
  impuestosDocSustento: RetencionImpuestoSustentoDto[];

  @ApiProperty({ type: [RetencionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RetencionItemDto)
  retenciones: RetencionItemDto[];

  @ApiProperty({ type: [RetencionPagoSustentoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RetencionPagoSustentoDto)
  pagos: RetencionPagoSustentoDto[];
}

export class RetentionAdditionalFieldDto {
  @ApiProperty({ example: 'Email' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'proveedor@empresa.com' })
  @IsString()
  @IsNotEmpty()
  valor: string;
}

export class CreateRetentionDto {
  @ApiProperty({ example: 'RET-2026-0001' })
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @ApiProperty({ enum: ['1', '2'], example: '1' })
  @IsIn(['1', '2'])
  ambiente: '1' | '2';

  @ApiPropertyOptional({ example: 'https://saas.example.com/webhooks/sri' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @ApiProperty({ example: 'CARROCERIAS INDUSTRIALES S.A.' })
  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @ApiPropertyOptional({ example: 'CARROINSA' })
  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @ApiProperty({ example: '1890000000001' })
  @IsString()
  @Length(13, 13)
  @Matches(/^\d{13}$/)
  ruc: string;

  @ApiProperty({ example: '001' })
  @IsString()
  @Matches(/^\d{3}$/)
  estab: string;

  @ApiProperty({ example: '001' })
  @IsString()
  @Matches(/^\d{3}$/)
  ptoEmi: string;

  @ApiProperty({ example: '000000001' })
  @IsString()
  @Matches(/^\d{1,9}$/)
  secuencial: string;

  @ApiProperty({ example: 'AV. INDOAMERICA KM 5' })
  @IsString()
  @IsNotEmpty()
  dirMatriz: string;

  @ApiProperty({ example: '11/11/2026' })
  @IsString()
  @IsNotEmpty()
  fechaEmision: string;

  @ApiProperty({ example: 'AV. INDOAMERICA KM 5' })
  @IsString()
  @IsNotEmpty()
  dirEstablecimiento: string;

  @ApiPropertyOptional({ example: 'SI' })
  @IsOptional()
  @IsIn(['SI', 'NO'])
  obligadoContabilidad?: 'SI' | 'NO';

  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  contribuyenteEspecial?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  agenteRetencion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contribuyenteRimpe?: string;

  @ApiProperty({ example: '04', description: '04=RUC, 05=Cédula, 06=Pasaporte' })
  @IsString()
  @IsNotEmpty()
  tipoIdentificacionSujetoRetenido: string;

  @ApiProperty({ example: 'NO' })
  @IsIn(['SI', 'NO'])
  parteRel: 'SI' | 'NO';

  @ApiProperty({ example: 'CORPORACION FAVORITA C.A.' })
  @IsString()
  @IsNotEmpty()
  razonSocialSujetoRetenido: string;

  @ApiProperty({ example: '1790016919001' })
  @IsString()
  @IsNotEmpty()
  identificacionSujetoRetenido: string;

  @ApiProperty({ example: '11/2026', description: 'MM/YYYY' })
  @IsString()
  @Matches(/^\d{2}\/\d{4}$/)
  periodoFiscal: string;

  @ApiProperty({ type: [DocSustentoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DocSustentoDto)
  docsSustento: DocSustentoDto[];

  @ApiPropertyOptional({ type: [RetentionAdditionalFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RetentionAdditionalFieldDto)
  infoAdicional?: RetentionAdditionalFieldDto[];
}

