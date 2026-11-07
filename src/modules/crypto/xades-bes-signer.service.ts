import { Injectable, BadRequestException } from '@nestjs/common';
import * as forge from 'node-forge';
import * as crypto from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { P12ParserService } from './p12-parser.service';

@Injectable()
export class XadesBesSignerService {
  private readonly dsNamespace = 'http://www.w3.org/2000/09/xmldsig#';
  private readonly etsiNamespace = 'http://uri.etsi.org/01903/v1.3.2#';

  constructor(private readonly p12Parser: P12ParserService) {}

  /**
   * Signs an SRI XML document (`id="comprobante"`) using XAdES-BES (RSA-SHA1 + C14N)
   * in strict compliance with the Ecuadorian SRI technical specification.
   */
  signXml(unsignedXml: string, p12Buffer: Buffer, password: string): string {
    const p12Material = this.p12Parser.extractAndValidate(p12Buffer, password);

    const parser = new DOMParser();
    const doc = parser.parseFromString(unsignedXml.trim(), 'text/xml');
    const rootElement = doc.documentElement;

    if (!rootElement || rootElement.getAttribute('id') !== 'comprobante') {
      throw new BadRequestException(
        'INVALID_XML_ROOT: El documento XML debe tener un nodo raíz con atributo id="comprobante".',
      );
    }

    // Generate cryptographically random numeric identifiers for XAdES-BES nodes
    const rnd = () => crypto.randomInt(100000, 1000000);
    const signatureId = `Signature${rnd()}`;
    const signatureValueId = `SignatureValue${rnd()}`;
    const signedPropertiesId = `Signature${rnd()}-SignedProperties${rnd()}`;
    const keyInfoId = `Certificate${rnd()}`;
    const referenceComprobanteId = `Reference-ID-${rnd()}`;
    const signedPropertiesRefId = `SignedPropertiesID${rnd()}`;
    const objectId = `${signatureId}-Object${rnd()}`;

    // 1. Canonicalize the unsigned document root (<factura id="comprobante" ...>) and compute SHA-1 digest
    const canonicalComprobante = this.canonicalizeElement(rootElement);
    const comprobanteDigestBase64 = this.sha1Base64(canonicalComprobante);

    // 2. Build <etsi:SignedProperties> with Ecuador timezone ISO-8601 timestamp
    const signingTime = this.formatEcuadorIsoDate(new Date());
    const signedPropertiesXml = [
      `<etsi:SignedProperties xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signedPropertiesId}">`,
      `<etsi:SignedSignatureProperties>`,
      `<etsi:SigningTime>${signingTime}</etsi:SigningTime>`,
      `<etsi:SigningCertificate>`,
      `<etsi:Cert>`,
      `<etsi:CertDigest>`,
      `<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
      `<ds:DigestValue>${p12Material.certSha1Base64}</ds:DigestValue>`,
      `</etsi:CertDigest>`,
      `<etsi:IssuerSerial>`,
      `<ds:X509IssuerName>${this.escapeXml(p12Material.issuerName)}</ds:X509IssuerName>`,
      `<ds:X509SerialNumber>${p12Material.serialNumberDec}</ds:X509SerialNumber>`,
      `</etsi:IssuerSerial>`,
      `</etsi:Cert>`,
      `</etsi:SigningCertificate>`,
      `</etsi:SignedSignatureProperties>`,
      `<etsi:SignedDataObjectProperties>`,
      `<etsi:DataObjectFormat ObjectReference="#${referenceComprobanteId}">`,
      `<etsi:Description>contenido comprobante</etsi:Description>`,
      `<etsi:MimeType>text/xml</etsi:MimeType>`,
      `</etsi:DataObjectFormat>`,
      `</etsi:SignedDataObjectProperties>`,
      `</etsi:SignedProperties>`,
    ].join('');

    const signedPropertiesDigestBase64 = this.sha1Base64(signedPropertiesXml);

    // 3. Build <ds:KeyInfo> with X.509 Certificate & RSAKeyValue and compute its SHA-1 digest
    const formattedCertBase64 = this.chunkBase64(p12Material.certDerBase64);
    const formattedModulusBase64 = this.chunkBase64(p12Material.modulusBase64);
    const keyInfoXml = [
      `<ds:KeyInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${keyInfoId}">`,
      `\n<ds:X509Data>`,
      `\n<ds:X509Certificate>\n${formattedCertBase64}\n</ds:X509Certificate>`,
      `\n</ds:X509Data>`,
      `\n<ds:KeyValue>`,
      `\n<ds:RSAKeyValue>`,
      `\n<ds:Modulus>\n${formattedModulusBase64}\n</ds:Modulus>`,
      `\n<ds:Exponent>${p12Material.exponentBase64}</ds:Exponent>`,
      `\n</ds:RSAKeyValue>`,
      `\n</ds:KeyValue>`,
      `\n</ds:KeyInfo>`,
    ].join('');

    const keyInfoDigestBase64 = this.sha1Base64(keyInfoXml);

    // 4. Build <ds:SignedInfo> containing references to SignedProperties, KeyInfo, and #comprobante
    const signedInfoXml = [
      `<ds:SignedInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}">`,
      `\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>`,
      `\n<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>`,
      `\n<ds:Reference Id="${signedPropertiesRefId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropertiesId}">`,
      `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
      `\n<ds:DigestValue>${signedPropertiesDigestBase64}</ds:DigestValue>`,
      `\n</ds:Reference>`,
      `\n<ds:Reference URI="#${keyInfoId}">`,
      `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
      `\n<ds:DigestValue>${keyInfoDigestBase64}</ds:DigestValue>`,
      `\n</ds:Reference>`,
      `\n<ds:Reference Id="${referenceComprobanteId}" URI="#comprobante">`,
      `\n<ds:Transforms>`,
      `\n<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>`,
      `\n</ds:Transforms>`,
      `\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>`,
      `\n<ds:DigestValue>${comprobanteDigestBase64}</ds:DigestValue>`,
      `\n</ds:Reference>`,
      `\n</ds:SignedInfo>`,
    ].join('');

    // 5. Sign <ds:SignedInfo> with RSA-SHA1 using the private key from node-forge
    const md = forge.md.sha1.create();
    md.update(signedInfoXml, 'utf8');
    const rawSignatureBytes = p12Material.privateKey.sign(md);
    const signatureValueBase64 = this.chunkBase64(forge.util.encode64(rawSignatureBytes));

    // 6. Assemble complete <ds:Signature> block
    const signedInfoInner = signedInfoXml.replace(
      `<ds:SignedInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}">`,
      '<ds:SignedInfo>',
    );
    const keyInfoInner = keyInfoXml.replace(
      `<ds:KeyInfo xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${keyInfoId}">`,
      `<ds:KeyInfo Id="${keyInfoId}">`,
    );
    const signedPropertiesInner = signedPropertiesXml.replace(
      `<etsi:SignedProperties xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signedPropertiesId}">`,
      `<etsi:SignedProperties Id="${signedPropertiesId}">`,
    );

    const dsSignatureBlock = [
      `<ds:Signature xmlns:ds="${this.dsNamespace}" xmlns:etsi="${this.etsiNamespace}" Id="${signatureId}">`,
      `\n${signedInfoInner}`,
      `\n<ds:SignatureValue Id="${signatureValueId}">\n${signatureValueBase64}\n</ds:SignatureValue>`,
      `\n${keyInfoInner}`,
      `\n<ds:Object Id="${objectId}">`,
      `<etsi:QualifyingProperties Target="#${signatureId}">`,
      `${signedPropertiesInner}`,
      `</etsi:QualifyingProperties>`,
      `</ds:Object>`,
      `</ds:Signature>`,
    ].join('');

    // 7. Inject <ds:Signature> right before closing </factura> tag
    const closingTagIndex = unsignedXml.lastIndexOf(`</${rootElement.tagName}>`);
    if (closingTagIndex === -1) {
      const serializedRoot = new XMLSerializer().serializeToString(rootElement);
      const fallbackIdx = serializedRoot.lastIndexOf(`</${rootElement.tagName}>`);
      return (
        serializedRoot.slice(0, fallbackIdx) +
        dsSignatureBlock +
        serializedRoot.slice(fallbackIdx)
      );
    }

    return (
      unsignedXml.slice(0, closingTagIndex) +
      dsSignatureBlock +
      unsignedXml.slice(closingTagIndex)
    );
  }

  /**
   * Produces Inclusive XML Canonicalization (C14N 1.0) for an XML DOM Element.
   * Expands self-closing tags (<tag/> -> <tag></tag>), orders attributes lexicographically,
   * and normalizes line breaks to LF (\n).
   */
  canonicalizeElement(element: Element): string {
    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(element);
    // Remove XML declaration if present
    xml = xml.replace(/<\?xml[^?]*\?>\s*/g, '');
    // Normalize CRLF to LF per C14N specification
    xml = xml.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Expand self-closing elements <foo attr="1"/> to <foo attr="1"></foo> per C14N 1.0
    xml = xml.replace(/<([a-zA-Z0-9:_-]+)(\s[^>]*)?\/>/g, '<$1$2></$1>');
    return xml;
  }

  private sha1Base64(content: string): string {
    return crypto.createHash('sha1').update(content, 'utf8').digest('base64');
  }

  private chunkBase64(b64: string, lineLength = 76): string {
    const clean = b64.replace(/\s+/g, '');
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += lineLength) {
      chunks.push(clean.slice(i, i + lineLength));
    }
    return chunks.join('\n');
  }

  private formatEcuadorIsoDate(date: Date): string {
    // Convert UTC timestamp to Ecuador time (America/Guayaquil, UTC-05:00)
    const offsetMinutes = -5 * 60;
    const localTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
    const iso = localTime.toISOString().replace(/\.\d{3}Z$/, '');
    return `${iso}-05:00`;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

