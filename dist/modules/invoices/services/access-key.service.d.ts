export interface AccessKeyParams {
    fechaEmision: string;
    codDoc?: string;
    ruc: string;
    ambiente: '1' | '2' | string;
    estab: string;
    ptoEmi: string;
    secuencial: string;
    codigoNumerico?: string;
    tipoEmision?: string;
}
export declare class AccessKeyService {
    generateAccessKey(params: AccessKeyParams): string;
    computeModulo11(base48: string): number;
    normalizeFechaToDdmmaaaa(fechaInput: string): string;
}
