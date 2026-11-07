import { P12ParserService } from './p12-parser.service';
export declare class XadesBesSignerService {
    private readonly p12Parser;
    private readonly dsNamespace;
    private readonly etsiNamespace;
    constructor(p12Parser: P12ParserService);
    signXml(unsignedXml: string, p12Buffer: Buffer, password: string): string;
    canonicalizeElement(element: Element): string;
    private sha1Base64;
    private chunkBase64;
    private formatEcuadorIsoDate;
    private escapeXml;
}
