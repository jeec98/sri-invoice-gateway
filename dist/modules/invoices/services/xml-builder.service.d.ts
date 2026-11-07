import { CreateInvoiceDto } from '../dto/create-invoice.dto';
export declare class XmlBuilderService {
    buildFacturaXml(dto: CreateInvoiceDto, claveAcceso: string): string;
    private aggregateTaxes;
    private normalizeFechaToDdMmYyyySlash;
    private formatAmount;
    private formatQuantity;
    private escapeXml;
}
