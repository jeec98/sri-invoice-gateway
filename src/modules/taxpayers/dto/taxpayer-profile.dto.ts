import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

export type TaxpayerRegimenTributario = 'GENERAL' | 'RIMPE_EMPRENDEDOR' | 'RIMPE_NEGOCIO_POPULAR';

export type TaxpayerTipoPersona = 'NATURAL' | 'SOCIEDAD';

export type TaxpayerProfileSource =
  | 'REDIS_CACHE'
  | 'DB_PROFILE'
  | 'DB_SPECIAL'
  | 'SRI_LIVE'
  | 'LOCAL_CATALOG_ONLY'
  | 'SYNTAX_ONLY'
  | 'LOCAL_FALLBACK';

export type WhoWithholds =
  'BUYER_WITHHOLDS' | 'SELLER_WITHHOLDS_NA' | 'NEITHER' | 'BUYER_ON_LIQUIDACION';

export class TaxpayerProfileResponseDto {
  @ApiProperty({ example: '1790016919001' })
  ruc: string;

  @ApiProperty({ example: true })
  rucValid: boolean;

  @ApiPropertyOptional({ example: 'CORPORACION FAVORITA C.A.', nullable: true })
  razonSocial: string | null;

  @ApiPropertyOptional({ example: 'SUPERMAXI', nullable: true })
  nombreComercial: string | null;

  @ApiProperty({ enum: ['NATURAL', 'SOCIEDAD'], example: 'SOCIEDAD' })
  tipoPersona: TaxpayerTipoPersona;

  @ApiProperty({
    enum: ['GENERAL', 'RIMPE_EMPRENDEDOR', 'RIMPE_NEGOCIO_POPULAR'],
    example: 'GENERAL',
  })
  regimenTributario: TaxpayerRegimenTributario;

  @ApiProperty({ example: true })
  obligadoContabilidad: boolean;

  @ApiProperty({ example: true })
  esContribuyenteEspecial: boolean;

  @ApiPropertyOptional({ example: '5368', nullable: true })
  resolucionContribuyenteEspecial: string | null;

  @ApiProperty({ example: true })
  esAgenteRetencion: boolean;

  @ApiPropertyOptional({ example: 'NAC-DNCRASC20-00000001', nullable: true })
  resolucionAgenteRetencion: string | null;

  @ApiPropertyOptional({ example: 'ACTIVO', nullable: true })
  estadoContribuyente: string | null;

  @ApiPropertyOptional({ nullable: true })
  actividadEconomica: string | null;

  @ApiPropertyOptional({ nullable: true })
  direccionMatriz: string | null;

  @ApiProperty({
    enum: [
      'REDIS_CACHE',
      'DB_PROFILE',
      'DB_SPECIAL',
      'SRI_LIVE',
      'LOCAL_CATALOG_ONLY',
      'SYNTAX_ONLY',
      'LOCAL_FALLBACK',
    ],
  })
  source: TaxpayerProfileSource;

  @ApiProperty({ example: false })
  stale: boolean;

  @ApiProperty({ example: false })
  degraded: boolean;

  @ApiPropertyOptional({ nullable: true })
  syncedAt: string | null;
}

export class TaxpayerProfileOverrideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  razonSocial?: string;

  @ApiPropertyOptional({ enum: ['NATURAL', 'SOCIEDAD'] })
  @IsOptional()
  @IsIn(['NATURAL', 'SOCIEDAD'])
  tipoPersona?: TaxpayerTipoPersona;

  @ApiPropertyOptional({ enum: ['GENERAL', 'RIMPE_EMPRENDEDOR', 'RIMPE_NEGOCIO_POPULAR'] })
  @IsOptional()
  @IsIn(['GENERAL', 'RIMPE_EMPRENDEDOR', 'RIMPE_NEGOCIO_POPULAR'])
  regimenTributario?: TaxpayerRegimenTributario;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  obligadoContabilidad?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esContribuyenteEspecial?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolucionContribuyenteEspecial?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esAgenteRetencion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolucionAgenteRetencion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estadoContribuyente?: string | null;
}

export class WithholdingEligibilityDto {
  @ApiProperty({ example: '1790016919001' })
  @IsString()
  @Length(13, 13)
  @Matches(/^\d{13}$/, { message: 'buyerRuc debe tener exactamente 13 dígitos numéricos.' })
  buyerRuc: string;

  @ApiProperty({ example: '1790011674001' })
  @IsString()
  @Length(13, 13)
  @Matches(/^\d{13}$/, { message: 'sellerRuc debe tener exactamente 13 dígitos numéricos.' })
  sellerRuc: string;

  @ApiPropertyOptional({ example: '01', enum: ['01', '02', '03', '04', '05'] })
  @IsOptional()
  @IsString()
  @IsIn(['01', '02', '03', '04', '05'])
  codDocSustento?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  emitirCeroInformativa?: boolean;

  @ApiPropertyOptional({ type: TaxpayerProfileOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxpayerProfileOverrideDto)
  buyerProfileOverride?: TaxpayerProfileOverrideDto;

  @ApiPropertyOptional({ type: TaxpayerProfileOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxpayerProfileOverrideDto)
  sellerProfileOverride?: TaxpayerProfileOverrideDto;
}

export class WithholdingEligibilityResponseDto {
  @ApiProperty({ type: TaxpayerProfileResponseDto })
  buyer: TaxpayerProfileResponseDto;

  @ApiProperty({ type: TaxpayerProfileResponseDto })
  seller: TaxpayerProfileResponseDto;

  @ApiProperty({
    enum: ['BUYER_WITHHOLDS', 'SELLER_WITHHOLDS_NA', 'NEITHER', 'BUYER_ON_LIQUIDACION'],
  })
  whoWithholds: WhoWithholds;

  @ApiProperty()
  obligatorioRenta: boolean;

  @ApiProperty()
  obligatorioIva: boolean;

  @ApiProperty()
  aplicaRetencionIvaEntreEspeciales: boolean;

  @ApiProperty()
  motivoLegal: string;

  @ApiProperty({ type: [String] })
  reglasAplicables: string[];

  @ApiProperty()
  buyerEligible: boolean;

  @ApiProperty()
  sellerIsRimpePopular: boolean;

  @ApiProperty()
  applyRetention: boolean;

  @ApiProperty()
  zeroInformativePolicy: boolean;

  @ApiProperty()
  reasonCode: string;
}

export class TriggerSyncDto {
  @ApiPropertyOptional({
    enum: ['ALL', 'AGENTS', 'SPECIAL', 'RIMPE'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['ALL', 'AGENTS', 'SPECIAL', 'RIMPE'])
  source?: 'ALL' | 'AGENTS' | 'SPECIAL' | 'RIMPE';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class TriggerSyncResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: true })
  queued: boolean;

  @ApiPropertyOptional({ example: false })
  deduplicated?: boolean;

  @ApiProperty({ example: 'sync-sri-catalogs-ALL' })
  jobId: string;

  @ApiProperty({ example: 'ALL' })
  source: string;
}
