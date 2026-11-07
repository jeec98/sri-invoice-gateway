import * as forge from 'node-forge';
export interface ParsedP12Material {
    privateKey: forge.pki.rsa.PrivateKey;
    certificate: forge.pki.Certificate;
    certDerBase64: string;
    certSha1Base64: string;
    issuerName: string;
    subjectName: string;
    serialNumberDec: string;
    modulusBase64: string;
    exponentBase64: string;
    validFrom: Date;
    validTo: Date;
}
export declare class P12ParserService {
    extractAndValidate(p12Buffer: Buffer, password: string): ParsedP12Material;
    private formatDistinguishedName;
    private mapOidToShortName;
}
