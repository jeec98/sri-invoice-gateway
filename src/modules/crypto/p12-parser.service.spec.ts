import { describe, it, expect, beforeEach } from 'vitest';
import * as forge from 'node-forge';
import { P12ParserService } from './p12-parser.service';
import { BadRequestException } from '@nestjs/common';

function createTestP12Buffer(password: string, validFrom: Date, validTo: Date): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0123456789ABCDEF';
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validTo;

  const attrs = [
    { name: 'commonName', value: 'PRUEBAS SERVICIO DE RENTAS INTERNAS' },
    { name: 'countryName', value: 'EC' },
    { name: 'organizationName', value: 'BANCO CENTRAL DEL ECUADOR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

describe('P12ParserService', () => {
  let service: P12ParserService;

  beforeEach(() => {
    service = new P12ParserService();
  });

  it('should parse a valid .p12 buffer and extract key, certificate, DER base64, and issuer/serial', () => {
    const now = new Date();
    const validFrom = new Date(now.getTime() - 86400 * 1000);
    const validTo = new Date(now.getTime() + 365 * 86400 * 1000);
    const password = 'ValidP12Password!';

    const p12Buffer = createTestP12Buffer(password, validFrom, validTo);
    const parsed = service.extractAndValidate(p12Buffer, password);

    expect(parsed.privateKey).toBeDefined();
    expect(parsed.certificate).toBeDefined();
    expect(parsed.certDerBase64).toBeTypeOf('string');
    expect(parsed.certDerBase64.length).toBeGreaterThan(100);
    expect(parsed.certSha1Base64).toBeTypeOf('string');
    expect(parsed.issuerName).toContain('CN=PRUEBAS SERVICIO DE RENTAS INTERNAS');
    expect(parsed.serialNumberDec).toBeDefined();
    expect(parsed.validTo.getTime()).toBeGreaterThan(now.getTime());
  });

  it('should throw BadRequestException when password is incorrect', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer(
      'CorrectPassword',
      new Date(now.getTime() - 86400 * 1000),
      new Date(now.getTime() + 86400 * 1000),
    );

    expect(() => service.extractAndValidate(p12Buffer, 'WrongPassword')).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException when certificate is expired', () => {
    const pastStart = new Date('2020-01-01T00:00:00Z');
    const pastEnd = new Date('2021-01-01T00:00:00Z');
    const password = 'ExpiredCertPassword';

    const p12Buffer = createTestP12Buffer(password, pastStart, pastEnd);

    expect(() => service.extractAndValidate(p12Buffer, password)).toThrow(BadRequestException);
  });
});
