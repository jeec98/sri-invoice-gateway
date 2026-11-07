export declare class InvoiceTaxItemDto {
    codigo: string;
    codigoPorcentaje: string;
    tarifa: number;
    baseImponible: number;
    valor: number;
}
export declare class InvoiceDetailDto {
    codigoPrincipal: string;
    codigoAuxiliar?: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento: number;
    precioTotalSinImpuesto: number;
    impuestos: InvoiceTaxItemDto[];
}
export declare class InvoicePagoDto {
    formaPago: string;
    total: number;
    plazo?: string;
    unidadTiempo?: string;
}
export declare class InfoAdicionalFieldDto {
    nombre: string;
    valor: string;
}
export declare class CreateInvoiceDto {
    referenceId: string;
    ambiente: '1' | '2';
    webhookUrl: string;
    razonSocial: string;
    nombreComercial?: string;
    ruc: string;
    estab: string;
    ptoEmi: string;
    secuencial: string;
    dirMatriz: string;
    fechaEmision: string;
    dirEstablecimiento: string;
    obligadoContabilidad?: 'SI' | 'NO';
    tipoIdentificacionComprador: string;
    razonSocialComprador: string;
    identificacionComprador: string;
    direccionComprador?: string;
    totalSinImpuestos: number;
    totalDescuento: number;
    propina?: number;
    importeTotal: number;
    moneda?: string;
    pagos: InvoicePagoDto[];
    detalles: InvoiceDetailDto[];
    infoAdicional?: InfoAdicionalFieldDto[];
}
