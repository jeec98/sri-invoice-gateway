export interface SriMessage {
    identificador: string;
    mensaje: string;
    informacionAdicional?: string;
    tipo: string;
}
export interface SriRecepcionResult {
    estado: 'RECIBIDA' | 'DEVUELTA' | string;
    mensajes: SriMessage[];
    rawXml: string;
}
export interface SriAutorizacionResult {
    estado: 'AUTORIZADO' | 'NO AUTORIZADO' | 'EN PROCESO' | string;
    numeroAutorizacion?: string;
    fechaAutorizacion?: string;
    ambiente?: string;
    comprobanteXml?: string;
    authorizedXml?: string;
    mensajes: SriMessage[];
    rawXml: string;
}
export declare class SriSoapClientService {
    private readonly logger;
    private readonly endpoints;
    validarComprobante(signedXml: string, ambiente: '1' | '2' | string): Promise<SriRecepcionResult>;
    autorizacionComprobante(claveAcceso: string, ambiente: '1' | '2' | string): Promise<SriAutorizacionResult>;
    buildRecepcionEnvelope(xmlBase64: string): string;
    buildAutorizacionEnvelope(claveAcceso: string): string;
    parseRecepcionResponse(soapXml: string): SriRecepcionResult;
    parseAutorizacionResponse(soapXml: string): SriAutorizacionResult;
    private buildAuthorizedDocumentXml;
    private extractMessages;
    private extractNodeText;
}
