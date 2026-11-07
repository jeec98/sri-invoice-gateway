import { BadRequestException, Injectable } from '@nestjs/common';
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

@Injectable()
export class P12ParserService {
  extractAndValidate(p12Buffer: Buffer, password: string): ParsedP12Material {
    if (!p12Buffer || p12Buffer.length === 0) {
      throw new BadRequestException('CERTIFICATE_EMPTY: El archivo .p12 está vacío.');
    }

    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const derBytes = p12Buffer.toString('binary');
      const asn1 = forge.asn1.fromDer(derBytes);
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    } catch {
      throw new BadRequestException(
        'INVALID_CERTIFICATE_PASSWORD: No se pudo abrir el archivo .p12. Verifique el archivo y la contraseña proporcionada.',
      );
    }

    // Extract private key (support both shrouded key bags and standard key bags)
    const shroudedBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] || [];
    const plainKeyBags =
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    const allKeyBags = [...shroudedBags, ...plainKeyBags].filter((b) => b && b.key);

    if (allKeyBags.length === 0) {
      throw new BadRequestException(
        'PRIVATE_KEY_NOT_FOUND: No se encontró una clave privada dentro del archivo .p12.',
      );
    }

    // Extract certificate bags
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const validCertBags = certBags.filter((b) => b && b.cert);

    if (validCertBags.length === 0) {
      throw new BadRequestException(
        'CERTIFICATE_NOT_FOUND: No se encontró ningún certificado X.509 dentro del archivo .p12.',
      );
    }

    // Match private key with signing certificate (prefer the end-entity certificate that matches the key's modulus)
    let selectedKey = allKeyBags[0].key as forge.pki.rsa.PrivateKey;
    let selectedCert = validCertBags[0].cert as forge.pki.Certificate;

    for (const keyBag of allKeyBags) {
      const candidateKey = keyBag.key as forge.pki.rsa.PrivateKey;
      for (const certBag of validCertBags) {
        const candidateCert = certBag.cert as forge.pki.Certificate;
        const pubKey = candidateCert.publicKey as forge.pki.rsa.PublicKey;
        if (
          pubKey &&
          candidateKey &&
          pubKey.n &&
          candidateKey.n &&
          pubKey.n.compareTo(candidateKey.n) === 0
        ) {
          selectedKey = candidateKey;
          selectedCert = candidateCert;
          break;
        }
      }
    }

    const now = new Date();
    const validFrom = selectedCert.validity.notBefore;
    const validTo = selectedCert.validity.notAfter;

    if (now > validTo) {
      throw new BadRequestException(
        `CERTIFICATE_EXPIRED: El certificado electrónico caducó el ${validTo.toISOString()}.`,
      );
    }

    if (now < validFrom) {
      throw new BadRequestException(
        `CERTIFICATE_NOT_YET_VALID: El certificado electrónico aún no entra en vigencia (${validFrom.toISOString()}).`,
      );
    }

    // Convert certificate to X.509 DER and Base64
    const certAsn1 = forge.pki.certificateToAsn1(selectedCert);
    const certDerBytes = forge.asn1.toDer(certAsn1).getBytes();
    const certDerBase64 = forge.util.encode64(certDerBytes);

    // Compute SHA-1 digest of the DER certificate
    const sha1Md = forge.md.sha1.create();
    sha1Md.update(certDerBytes);
    const certSha1Base64 = forge.util.encode64(sha1Md.digest().getBytes());

    // Format Issuer Name and Subject Name according to RFC 2253 (reverse order expected by SRI XAdES-BES)
    const issuerName = this.formatDistinguishedName(selectedCert.issuer.attributes);
    const subjectName = this.formatDistinguishedName(selectedCert.subject.attributes);

    // Convert Hex Serial Number to Decimal string for X509SerialNumber
    const cleanHexSerial = (selectedCert.serialNumber || '01').replace(/[^0-9a-fA-F]/g, '');
    const serialNumberDec = BigInt(`0x${cleanHexSerial || '01'}`).toString(10);

    // Extract RSA Public Key Modulus and Exponent in Base64
    const pubKey = selectedCert.publicKey as forge.pki.rsa.PublicKey;
    const modulusHex = pubKey.n.toString(16);
    const paddedModulusHex = modulusHex.length % 2 === 1 ? `0${modulusHex}` : modulusHex;
    const modulusBase64 = Buffer.from(paddedModulusHex, 'hex').toString('base64');

    const exponentHex = pubKey.e.toString(16);
    const paddedExponentHex = exponentHex.length % 2 === 1 ? `0${exponentHex}` : exponentHex;
    const exponentBase64 = Buffer.from(paddedExponentHex, 'hex').toString('base64');

    return {
      privateKey: selectedKey,
      certificate: selectedCert,
      certDerBase64,
      certSha1Base64,
      issuerName,
      subjectName,
      serialNumberDec,
      modulusBase64,
      exponentBase64,
      validFrom,
      validTo,
    };
  }

  private formatDistinguishedName(attributes: forge.pki.CertificateField[]): string {
    return [...attributes]
      .reverse()
      .map((attr) => {
        const shortName =
          attr.shortName || this.mapOidToShortName(attr.type || '') || attr.name || 'OID';
        return `${shortName}=${attr.value}`;
      })
      .join(',');
  }

  private mapOidToShortName(oid: string): string | undefined {
    const map: Record<string, string> = {
      '2.5.4.3': 'CN',
      '2.5.4.6': 'C',
      '2.5.4.7': 'L',
      '2.5.4.8': 'ST',
      '2.5.4.10': 'O',
      '2.5.4.11': 'OU',
      '2.5.4.5': 'SERIALNUMBER',
    };
    return map[oid];
  }
}
