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

export class InvoiceTaxItemDto {
  @ApiProperty({
    description: 'Código del impuesto según tabla SRI (2 = IVA, 3 = ICE, 5 = IRBPNR)',
    example: '2',
  })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({
    description:
      'Código de porcentaje según SRI (0 = 0%, 4 = 15%, 6 = No Objeto de Impuesto, 7 = Exento de IVA)',
    example: '4',
  })
  @IsString()
  @IsNotEmpty()
  codigoPorcentaje: string;

  @ApiProperty({
    description: 'Tarifa porcentual aplicada (ej. 15, 0)',
    example: 15,
  })
  @IsNumber()
  @Min(0)
  tarifa: number;

  @ApiProperty({
    description: 'Base imponible sobre la cual se calcula el impuesto',
    example: 100.0,
  })
  @IsNumber()
  @Min(0)
  baseImponible: number;

  @ApiProperty({
    description: 'Valor monetario del impuesto calculado',
    example: 15.0,
  })
  @IsNumber()
  @Min(0)
  valor: number;
}

export class InvoiceDetailDto {
  @ApiProperty({ example: 'PROD-001' })
  @IsString()
  @IsNotEmpty()
  codigoPrincipal: string;

  @ApiPropertyOptional({ example: 'AUX-001' })
  @IsOptional()
  @IsString()
  codigoAuxiliar?: string;

  @ApiProperty({ example: 'Licencia Anual Software Contable Cloud' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.000001)
  cantidad: number;

  @ApiProperty({ example: 100.0 })
  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @ApiProperty({ example: 0.0 })
  @IsNumber()
  @Min(0)
  descuento: number;

  @ApiProperty({ example: 100.0 })
  @IsNumber()
  @Min(0)
  precioTotalSinImpuesto: number;

  @ApiProperty({ type: [InvoiceTaxItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceTaxItemDto)
  impuestos: InvoiceTaxItemDto[];
}

export class InvoicePagoDto {
  @ApiProperty({
    description:
      'Código forma de pago SRI (01 = Sin utilización del sistema financiero, 20 = Otros con utilización del sistema financiero)',
    example: '20',
  })
  @IsString()
  @IsNotEmpty()
  formaPago: string;

  @ApiProperty({ example: 115.0 })
  @IsNumber()
  @Min(0)
  total: number;

  @ApiPropertyOptional({ example: '30' })
  @IsOptional()
  @IsString()
  plazo?: string;

  @ApiPropertyOptional({ example: 'dias' })
  @IsOptional()
  @IsString()
  unidadTiempo?: string;
}

export class InfoAdicionalFieldDto {
  @ApiProperty({ example: 'Email' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'facturacion@cliente.com.ec' })
  @IsString()
  @IsNotEmpty()
  valor: string;
}

export class CreateInvoiceDto {
  @ApiProperty({
    description: 'Identificador único de referencia de la factura en el SaaS externo',
    example: 'INV-2026-000123',
  })
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @ApiProperty({
    description: 'Ambiente del SRI: "1" = Pruebas (celcer), "2" = Producción (cel)',
    enum: ['1', '2'],
    example: '1',
  })
  @IsString()
  @IsIn(['1', '2'])
  ambiente: '1' | '2';

  @ApiProperty({
    description: 'URL del Webhook en el SaaS donde se notificará el resultado final',
    example: 'https://mi-saas.com/api/webhooks/sri',
  })
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @IsNotEmpty()
  webhookUrl: string;

  // Datos Tributarios del Emisor
  @ApiProperty({ example: 'EMPRESA DEMO SAAS ECUADOR S.A.' })
  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @ApiPropertyOptional({ example: 'DEMO SAAS' })
  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @ApiProperty({ example: '1790011674001' })
  @IsString()
  @Length(13, 13)
  @Matches(/^\d{13}$/)
  ruc: string;

  @ApiProperty({ example: '001' })
  @IsString()
  @Matches(/^\d{1,3}$/)
  estab: string;

  @ApiProperty({ example: '001' })
  @IsString()
  @Matches(/^\d{1,3}$/)
  ptoEmi: string;

  @ApiProperty({ example: '000000123' })
  @IsString()
  @Matches(/^\d{1,9}$/)
  secuencial: string;

  @ApiProperty({ example: 'AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO' })
  @IsString()
  @IsNotEmpty()
  dirMatriz: string;

  // Datos de la Factura (infoFactura)
  @ApiProperty({
    description: 'Fecha de emisión en formato dd/mm/aaaa',
    example: '07/11/2026',
  })
  @IsString()
  @IsNotEmpty()
  fechaEmision: string;

  @ApiProperty({ example: 'AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO' })
  @IsString()
  @IsNotEmpty()
  dirEstablecimiento: string;

  @ApiPropertyOptional({
    enum: ['SI', 'NO'],
    example: 'SI',
  })
  @IsOptional()
  @IsIn(['SI', 'NO'])
  obligadoContabilidad?: 'SI' | 'NO';

  @ApiProperty({
    description:
      '04 = RUC, 05 = Cédula, 06 = Pasaporte, 07 = Consumidor Final, 08 = Identificación Exterior',
    example: '04',
  })
  @IsString()
  @IsIn(['04', '05', '06', '07', '08'])
  tipoIdentificacionComprador: string;

  @ApiProperty({ example: 'COMERCIALIZADORA DEL PACIFICO S.A.' })
  @IsString()
  @IsNotEmpty()
  razonSocialComprador: string;

  @ApiProperty({ example: '0991234567001' })
  @IsString()
  @IsNotEmpty()
  identificacionComprador: string;

  @ApiPropertyOptional({ example: 'AV. 9 DE OCTUBRE, GUAYAQUIL' })
  @IsOptional()
  @IsString()
  direccionComprador?: string;

  @ApiProperty({ example: 100.0 })
  @IsNumber()
  @Min(0)
  totalSinImpuestos: number;

  @ApiProperty({ example: 0.0 })
  @IsNumber()
  @Min(0)
  totalDescuento: number;

  @ApiPropertyOptional({ example: 0.0, default: 0.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  propina?: number;

  @ApiProperty({ example: 115.0 })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  @ApiPropertyOptional({ example: 'DOLAR', default: 'DOLAR' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiProperty({ type: [InvoicePagoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoicePagoDto)
  pagos: InvoicePagoDto[];

  @ApiProperty({ type: [InvoiceDetailDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceDetailDto)
  detalles: InvoiceDetailDto[];

  @ApiPropertyOptional({ type: [InfoAdicionalFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InfoAdicionalFieldDto)
  infoAdicional?: InfoAdicionalFieldDto[];
}
