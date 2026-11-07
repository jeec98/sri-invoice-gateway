"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateInvoiceDto = exports.InfoAdicionalFieldDto = exports.InvoicePagoDto = exports.InvoiceDetailDto = exports.InvoiceTaxItemDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
class InvoiceTaxItemDto {
    codigo;
    codigoPorcentaje;
    tarifa;
    baseImponible;
    valor;
}
exports.InvoiceTaxItemDto = InvoiceTaxItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Código del impuesto según tabla SRI (2 = IVA, 3 = ICE, 5 = IRBPNR)',
        example: '2',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InvoiceTaxItemDto.prototype, "codigo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Código de porcentaje según SRI (0 = 0%, 4 = 15%, 6 = No Objeto de Impuesto, 7 = Exento de IVA)',
        example: '4',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InvoiceTaxItemDto.prototype, "codigoPorcentaje", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Tarifa porcentual aplicada (ej. 15, 0)',
        example: 15,
    }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceTaxItemDto.prototype, "tarifa", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Base imponible sobre la cual se calcula el impuesto',
        example: 100.0,
    }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceTaxItemDto.prototype, "baseImponible", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Valor monetario del impuesto calculado',
        example: 15.0,
    }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceTaxItemDto.prototype, "valor", void 0);
class InvoiceDetailDto {
    codigoPrincipal;
    codigoAuxiliar;
    descripcion;
    cantidad;
    precioUnitario;
    descuento;
    precioTotalSinImpuesto;
    impuestos;
}
exports.InvoiceDetailDto = InvoiceDetailDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'PROD-001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InvoiceDetailDto.prototype, "codigoPrincipal", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'AUX-001' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], InvoiceDetailDto.prototype, "codigoAuxiliar", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Licencia Anual Software Contable Cloud' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InvoiceDetailDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0.000001),
    __metadata("design:type", Number)
], InvoiceDetailDto.prototype, "cantidad", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceDetailDto.prototype, "precioUnitario", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceDetailDto.prototype, "descuento", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoiceDetailDto.prototype, "precioTotalSinImpuesto", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [InvoiceTaxItemDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => InvoiceTaxItemDto),
    __metadata("design:type", Array)
], InvoiceDetailDto.prototype, "impuestos", void 0);
class InvoicePagoDto {
    formaPago;
    total;
    plazo;
    unidadTiempo;
}
exports.InvoicePagoDto = InvoicePagoDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Código forma de pago SRI (01 = Sin utilización del sistema financiero, 20 = Otros con utilización del sistema financiero)',
        example: '20',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InvoicePagoDto.prototype, "formaPago", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 115.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], InvoicePagoDto.prototype, "total", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '30' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], InvoicePagoDto.prototype, "plazo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'dias' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], InvoicePagoDto.prototype, "unidadTiempo", void 0);
class InfoAdicionalFieldDto {
    nombre;
    valor;
}
exports.InfoAdicionalFieldDto = InfoAdicionalFieldDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Email' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InfoAdicionalFieldDto.prototype, "nombre", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'facturacion@cliente.com.ec' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], InfoAdicionalFieldDto.prototype, "valor", void 0);
class CreateInvoiceDto {
    referenceId;
    ambiente;
    webhookUrl;
    razonSocial;
    nombreComercial;
    ruc;
    estab;
    ptoEmi;
    secuencial;
    dirMatriz;
    fechaEmision;
    dirEstablecimiento;
    obligadoContabilidad;
    tipoIdentificacionComprador;
    razonSocialComprador;
    identificacionComprador;
    direccionComprador;
    totalSinImpuestos;
    totalDescuento;
    propina;
    importeTotal;
    moneda;
    pagos;
    detalles;
    infoAdicional;
}
exports.CreateInvoiceDto = CreateInvoiceDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Identificador único de referencia de la factura en el SaaS externo',
        example: 'INV-2026-000123',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "referenceId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Ambiente del SRI: "1" = Pruebas (celcer), "2" = Producción (cel)',
        enum: ['1', '2'],
        example: '1',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['1', '2']),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "ambiente", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'URL del Webhook en el SaaS donde se notificará el resultado final',
        example: 'https://mi-saas.com/api/webhooks/sri',
    }),
    (0, class_validator_1.IsUrl)({
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: false,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "webhookUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EMPRESA DEMO SAAS ECUADOR S.A.' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "razonSocial", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'DEMO SAAS' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "nombreComercial", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '1790011674001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(13, 13),
    (0, class_validator_1.Matches)(/^\d{13}$/),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "ruc", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{1,3}$/),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "estab", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{1,3}$/),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "ptoEmi", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '000000123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{1,9}$/),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "secuencial", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "dirMatriz", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Fecha de emisión en formato dd/mm/aaaa',
        example: '07/11/2026',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "fechaEmision", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "dirEstablecimiento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: ['SI', 'NO'],
        example: 'SI',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['SI', 'NO']),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "obligadoContabilidad", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: '04 = RUC, 05 = Cédula, 06 = Pasaporte, 07 = Consumidor Final, 08 = Identificación Exterior',
        example: '04',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['04', '05', '06', '07', '08']),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "tipoIdentificacionComprador", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'COMERCIALIZADORA DEL PACIFICO S.A.' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "razonSocialComprador", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '0991234567001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "identificacionComprador", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'AV. 9 DE OCTUBRE, GUAYAQUIL' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "direccionComprador", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateInvoiceDto.prototype, "totalSinImpuestos", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateInvoiceDto.prototype, "totalDescuento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 0.0, default: 0.0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateInvoiceDto.prototype, "propina", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 115.0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateInvoiceDto.prototype, "importeTotal", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'DOLAR', default: 'DOLAR' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "moneda", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [InvoicePagoDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => InvoicePagoDto),
    __metadata("design:type", Array)
], CreateInvoiceDto.prototype, "pagos", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [InvoiceDetailDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => InvoiceDetailDto),
    __metadata("design:type", Array)
], CreateInvoiceDto.prototype, "detalles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [InfoAdicionalFieldDto] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => InfoAdicionalFieldDto),
    __metadata("design:type", Array)
], CreateInvoiceDto.prototype, "infoAdicional", void 0);
//# sourceMappingURL=create-invoice.dto.js.map