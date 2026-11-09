import { describe, it, expect, beforeEach } from 'vitest';
import * as forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { P12ParserService } from './p12-parser.service';
import { XadesBesSignerService } from './xades-bes-signer.service';

function generateTestP12(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0102030405';
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 86400 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + 365 * 86400 * 1000);

  const attrs = [
    { name: 'commonName', value: 'EMISOR DE PRUEBA SRI' },
    { name: 'organizationName', value: 'SECURITY DATA S.A.' },
    { name: 'countryName', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha1.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

describe('XadesBesSignerService', () => {
  let p12Parser: P12ParserService;
  let signer: XadesBesSignerService;

  const sampleUnsignedXml = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>1</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>EMPRESA DEMO SA</razonSocial>
    <ruc>1790011674001</ruc>
    <claveAcceso>0711202601179001167400110010010000001231234567815</claveAcceso>
    <codDoc>01</codDoc>
    <estab>001</estab>
    <ptoEmi>001</ptoEmi>
    <secuencial>000000123</secuencial>
    <dirMatriz>AV AMAZONAS Y NACIONES UNIDAS</dirMatriz>
  </infoTributaria>
</factura>`;

  beforeEach(() => {
    p12Parser = new P12ParserService();
    signer = new XadesBesSignerService(p12Parser);
  });

  it('should sign an SRI XML invoice with XAdES-BES structure and valid RSA-SHA1 signature', () => {
    const password = 'TestSignaturePassword123';
    const p12Buffer = generateTestP12(password);

    const signedXml = signer.signXml(sampleUnsignedXml, p12Buffer, password);

    expect(signedXml).toContain('<ds:Signature');
    expect(signedXml).toContain('http://www.w3.org/TR/2001/REC-xml-c14n-20010315');
    expect(signedXml).toContain('http://www.w3.org/2000/09/xmldsig#rsa-sha1');
    expect(signedXml).toContain('URI="#comprobante"');
    expect(signedXml).toContain('<etsi:QualifyingProperties');
    expect(signedXml).toContain('<etsi:SignedProperties');
    expect(signedXml).toContain('<etsi:SigningTime>');
    expect(signedXml).toContain('<etsi:SigningCertificate>');
    expect(signedXml).toContain('<ds:X509IssuerName>');
    expect(signedXml).toContain('<ds:X509SerialNumber>');
    expect(signedXml).toContain('<ds:SignatureValue');
    expect(signedXml).toContain('<ds:KeyInfo');
    expect(signedXml).toContain('<ds:X509Data>');
    expect(signedXml).toContain('<ds:X509Certificate>');

    // Parse signed XML with @xmldom/xmldom and query with xpath to verify well-formed DOM
    const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
    const select = xpath.useNamespaces({
      ds: 'http://www.w3.org/2000/09/xmldsig#',
      etsi: 'http://uri.etsi.org/01903/v1.3.2#',
    });

    const sigNodes = select('//ds:Signature', doc) as Node[];
    expect(sigNodes.length).toBe(1);

    const signedPropsNodes = select('//etsi:SignedProperties', doc) as Node[];
    expect(signedPropsNodes.length).toBe(1);

    const sigValueNodes = select('//ds:SignatureValue/text()', doc) as Node[];
    expect(sigValueNodes.length).toBe(1);
    expect(String(sigValueNodes[0]).trim().length).toBeGreaterThan(64);
  });
});
