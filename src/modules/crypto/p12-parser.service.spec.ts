import { describe, it, expect, beforeEach } from 'vitest';
import * as forge from 'node-forge';
import { P12ParserService } from './p12-parser.service';
import { BadRequestException } from '@nestjs/common';

interface TestCertOptions {
  password: string;
  validFrom: Date;
  validTo: Date;
  issuerOrg?: string;
  subjectRuc?: string;
  mismatchPrivateKey?: boolean;
  serialNumberHex?: string;
}

function createTestP12Buffer(opts: TestCertOptions): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serialNumberHex || '0123456789ABCDEF';
  cert.validity.notBefore = opts.validFrom;
  cert.validity.notAfter = opts.validTo;

  const subjectAttrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'EMPRESA DEMO ECUADOR S.A.' },
    { name: 'countryName', value: 'EC' },
  ];
  if (opts.subjectRuc) {
    subjectAttrs.push({
      type: '2.5.4.5',
      shortName: 'SERIALNUMBER',
      value: `RUC-${opts.subjectRuc}`,
    });
  }

  const issuerAttrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'AUTORIDAD DE CERTIFICACION SUBCA-1' },
    { name: 'organizationName', value: opts.issuerOrg ?? 'BANCO CENTRAL DEL ECUADOR' },
    { name: 'countryName', value: 'EC' },
  ];

  cert.setSubject(subjectAttrs);
  cert.setIssuer(issuerAttrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Optionally bundle a different RSA private key to test integrity mismatch (Validation #4)
  const keyToBundle = opts.mismatchPrivateKey
    ? forge.pki.rsa.generateKeyPair(2048).privateKey
    : keys.privateKey;

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keyToBundle, [cert], opts.password, {
    algorithm: '3des',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

function createSyntheticCrlDer(revokedSerialHex: string): Buffer {
  const asn1 = forge.asn1;
  const serialBytes = forge.util.hexToBytes(revokedSerialHex);

  const tbsCertList = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    // 1st Universal SEQUENCE: signature (AlgorithmIdentifier)
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer('1.2.840.113549.1.1.11').getBytes(),
      ),
    ]),
    // 2nd Universal SEQUENCE: issuer (Name)
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, []),
    // thisUpdate (UTCTIME)
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, '261101000000Z'),
    // 3rd Universal SEQUENCE: revokedCertificates
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, serialBytes),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, '261105000000Z'),
      ]),
    ]),
  ]);

  const certList = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    tbsCertList,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, []),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, '\x00'),
  ]);

  return Buffer.from(asn1.toDer(certList).getBytes(), 'binary');
}

describe('P12ParserService — 6 SRI Digital Certificate Validations', () => {
  let service: P12ParserService;

  beforeEach(() => {
    service = new P12ParserService();
  });

  it('should parse a valid .p12 when all 6 validations pass (CA, Vigencia, Identidad RUC, Integridad, Revocación, Contraseña)', () => {
    const now = new Date();
    const validFrom = new Date(now.getTime() - 86400 * 1000);
    const validTo = new Date(now.getTime() + 365 * 86400 * 1000);
    const password = 'ValidP12Password!';
    const ruc = '1790011674001';

    const p12Buffer = createTestP12Buffer({
      password,
      validFrom,
      validTo,
      issuerOrg: 'SECURITY DATA S.A.',
      subjectRuc: ruc,
    });

    const parsed = service.extractAndValidate(p12Buffer, password, {
      expectedRuc: ruc,
    });

    expect(parsed.privateKey).toBeDefined();
    expect(parsed.certificate).toBeDefined();
    expect(parsed.certDerBase64.length).toBeGreaterThan(100);
    expect(parsed.issuerName).toContain('O=SECURITY DATA S.A.');
    expect(parsed.subjectName).toContain('SERIALNUMBER=RUC-1790011674001');
  });

  it('1. Entidad certificadora — should reject certificate from an unrecognized CA (UNRECOGNIZED_CA_ISSUER)', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer({
      password: 'SecretPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      issuerOrg: 'UNTRUSTED SELF CA INC',
      subjectRuc: '1790011674001',
    });

    expect(() =>
      service.extractAndValidate(p12Buffer, 'SecretPassword', {
        expectedRuc: '1790011674001',
      }),
    ).toThrow(/UNRECOGNIZED_CA_ISSUER/);
  });

  it('2. Vigencia — should reject expired certificate (CERTIFICATE_EXPIRED)', () => {
    const pastStart = new Date('2020-01-01T00:00:00Z');
    const pastEnd = new Date('2021-01-01T00:00:00Z');
    const password = 'ExpiredCertPassword';

    const p12Buffer = createTestP12Buffer({
      password,
      validFrom: pastStart,
      validTo: pastEnd,
      subjectRuc: '1790011674001',
    });

    expect(() => service.extractAndValidate(p12Buffer, password)).toThrow(/CERTIFICATE_EXPIRED/);
  });

  it('3. Identidad — should reject certificate whose RUC does not match the issuer RUC (CERTIFICATE_RUC_MISMATCH)', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer({
      password: 'SecretPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      subjectRuc: '0999999999001',
    });

    expect(() =>
      service.extractAndValidate(p12Buffer, 'SecretPassword', {
        expectedRuc: '1790011674001',
      }),
    ).toThrow(/CERTIFICATE_RUC_MISMATCH/);
  });

  it('3b. Identidad — should accept natural person certificate containing 10-digit Cédula for RUC ending in 001', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer({
      password: 'SecretPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      subjectRuc: '1712345678', // 10-digit Cédula of natural person RUC 1712345678001
    });

    const parsed = service.extractAndValidate(p12Buffer, 'SecretPassword', {
      expectedRuc: '1712345678001',
    });
    expect(parsed.subjectName).toContain('1712345678');
  });

  it('4. Integridad — should reject .p12 where certificate and private key do not correspond (CERTIFICATE_KEY_MISMATCH)', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer({
      password: 'SecretPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      subjectRuc: '1790011674001',
      mismatchPrivateKey: true,
    });

    expect(() =>
      service.extractAndValidate(p12Buffer, 'SecretPassword', {
        expectedRuc: '1790011674001',
      }),
    ).toThrow(/CERTIFICATE_KEY_MISMATCH/);
  });

  it('5. Revocación — should reject revoked certificate serials and detect revoked serials in X.509 CRL DER', () => {
    const now = new Date();
    const revokedHex = '0a0b0c0d0e0f';
    const p12Buffer = createTestP12Buffer({
      password: 'SecretPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      subjectRuc: '1790011674001',
      serialNumberHex: revokedHex,
    });

    expect(() =>
      service.extractAndValidate(p12Buffer, 'SecretPassword', {
        expectedRuc: '1790011674001',
        revokedSerialNumbers: [revokedHex],
      }),
    ).toThrow(/CERTIFICATE_REVOKED/);

    const crlDer = createSyntheticCrlDer(revokedHex);
    expect(service.isSerialInCrlDer(crlDer, revokedHex)).toBe(true);
    expect(service.isSerialInCrlDer(crlDer, '999999999999')).toBe(false);
  });

  it('6. Contraseña — should throw BadRequestException (INVALID_CERTIFICATE_PASSWORD) when password is incorrect', () => {
    const now = new Date();
    const p12Buffer = createTestP12Buffer({
      password: 'CorrectPassword',
      validFrom: new Date(now.getTime() - 86400 * 1000),
      validTo: new Date(now.getTime() + 86400 * 1000),
      subjectRuc: '1790011674001',
    });

    expect(() => service.extractAndValidate(p12Buffer, 'WrongPassword')).toThrow(
      BadRequestException,
    );
  });

  describe('inspectCertificate (Diagnóstico No Destructivo)', () => {
    it('debe inspeccionar exitosamente un .p12 válido sin lanzar excepciones', () => {
      const now = new Date();
      const p12Buffer = createTestP12Buffer({
        password: 'ValidPassword',
        validFrom: new Date(now.getTime() - 86400 * 1000),
        validTo: new Date(now.getTime() + 180 * 86400 * 1000), // 180 días
        subjectRuc: '1790011674001',
        issuerOrg: 'SECURITY DATA S.A.',
      });

      const diag = service.inspectCertificate(p12Buffer, 'ValidPassword', {
        expectedRuc: '1790011674001',
      });

      expect(diag.isValid).toBe(true);
      expect(diag.status).toBe('VALID');
      expect(diag.isAccreditedCa).toBe(true);
      expect(diag.matchesIssuerRuc).toBe(true);
      expect(diag.daysRemaining).toBeGreaterThan(170);
      expect(diag.issues).toHaveLength(0);
    });

    it('debe capturar contraseña incorrecta retornando isValid: false sin lanzar excepción', () => {
      const now = new Date();
      const p12Buffer = createTestP12Buffer({
        password: 'ValidPassword',
        validFrom: new Date(now.getTime() - 86400 * 1000),
        validTo: new Date(now.getTime() + 86400 * 1000),
      });

      const diag = service.inspectCertificate(p12Buffer, 'WrongPassword');

      expect(diag.isValid).toBe(false);
      expect(diag.status).toBe('INVALID_PASSWORD');
      expect(diag.issues.some((i) => i.code === 'CERTIFICATE_INVALID_PASSWORD')).toBe(true);
    });

    it('debe detectar certificado expirado y certificado próximo a caducar', () => {
      const now = new Date();
      // Expirado:
      const p12Expired = createTestP12Buffer({
        password: 'Pass',
        validFrom: new Date(now.getTime() - 400 * 86400 * 1000),
        validTo: new Date(now.getTime() - 10 * 86400 * 1000),
      });
      const diagExpired = service.inspectCertificate(p12Expired, 'Pass');
      expect(diagExpired.isValid).toBe(false);
      expect(diagExpired.status).toBe('EXPIRED');
      expect(diagExpired.issues.some((i) => i.code === 'CERTIFICATE_EXPIRED')).toBe(true);

      // Próximo a caducar (en 15 días):
      const p12ExpiringSoon = createTestP12Buffer({
        password: 'Pass',
        validFrom: new Date(now.getTime() - 300 * 86400 * 1000),
        validTo: new Date(now.getTime() + 15 * 86400 * 1000),
      });
      const diagSoon = service.inspectCertificate(p12ExpiringSoon, 'Pass');
      expect(diagSoon.isValid).toBe(true); // Válido pero con advertencia
      expect(diagSoon.status).toBe('EXPIRING_SOON');
      expect(diagSoon.issues.some((i) => i.code === 'CERTIFICATE_EXPIRING_SOON')).toBe(true);
    });

    it('debe detectar discrepancia de RUC emisor vs certificado', () => {
      const now = new Date();
      const p12Buffer = createTestP12Buffer({
        password: 'Pass',
        validFrom: new Date(now.getTime() - 86400 * 1000),
        validTo: new Date(now.getTime() + 60 * 86400 * 1000),
        subjectRuc: '1790011674001',
      });

      const diag = service.inspectCertificate(p12Buffer, 'Pass', {
        expectedRuc: '1792147820001', // RUC diferente
      });

      expect(diag.isValid).toBe(false);
      expect(diag.matchesIssuerRuc).toBe(false);
      expect(diag.issues.some((i) => i.code === 'CERTIFICATE_RUC_MISMATCH')).toBe(true);
    });
  });
});
