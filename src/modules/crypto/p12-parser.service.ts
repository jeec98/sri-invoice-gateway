import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as forge from 'node-forge';
import {
  CertificateHealthStatus,
  DiagnosticErrorCode,
  RevocationStatus,
} from '../diagnostics/constants/diagnostic-error-codes';
import {
  CertificateDiagnosticDto,
  DiagnosticIssueDto,
} from '../diagnostics/dto/diagnostic-response.dto';

export interface P12ValidationOptions {
  /**
   * 13-digit RUC of the issuing taxpayer (Tenant). When provided, the certificate's
   * Subject attributes or X.509v3 extensions MUST match this RUC (or its 10-digit Cédula
   * prefix for Ecuadorian natural person RUCs ending in 001).
   */
  expectedRuc?: string;
  /**
   * Whether to verify that the certificate was issued by an accredited Certification
   * Authority (Entidad Certificadora) recognized by the SRI in Ecuador. Defaults to true
   * unless ALLOW_UNRECOGNIZED_CA=true is set.
   */
  enforceAccreditedCa?: boolean;
  /**
   * Optional list of revoked certificate serial numbers (hex or decimal) to reject immediately.
   */
  revokedSerialNumbers?: string[];
}

export interface ParsedP12Material {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
  certDerBase64: string;
  certSha1Base64: string;
  issuerName: string;
  subjectName: string;
  serialNumberHex: string;
  serialNumberDec: string;
  modulusBase64: string;
  exponentBase64: string;
  validFrom: Date;
  validTo: Date;
  crlUrls: string[];
}

@Injectable()
export class P12ParserService {
  private readonly logger = new Logger(P12ParserService.name);

  /**
   * Accredited Certification Authorities (Entidades de Certificación de Información)
   * recognized by ARCOTEL and accepted by the Ecuadorian SRI for Electronic Invoicing.
   */
  private readonly recognizedCaPatterns: RegExp[] = [
    /SECURITY\s*DATA/i,
    /BANCO\s*CENTRAL\s*DEL\s*ECUADOR|\bECIBCE\b|\bBCE\b/i,
    /UANATACA/i,
    /\bANF\b|ANF\s*AC|AUTORIDAD\s*DE\s*CERTIFICACION\s*ECUADOR/i,
    /CONSEJO\s*DE\s*LA\s*JUDICATURA|ICERT-EC/i,
    /CORPNEWBEST|DATIL/i,
    /ECLIPSOFT/i,
    /LAZUS|ARGOSY|FIRMASEGURA|LETMI/i,
  ];

  /**
   * Enterprise OIDs assigned by IANA to Ecuadorian Certification Authorities:
   * - 1.3.6.1.4.1.37947: Banco Central del Ecuador (BCE)
   * - 1.3.6.1.4.1.37746: Security Data S.A.
   * - 1.3.6.1.4.1.37442: Consejo de la Judicatura (ICERT-EC)
   * - 1.3.6.1.4.1.47286: Uanataca S.A.
   * - 1.3.6.1.4.1.18332: ANF Autoridad de Certificación
   */
  private readonly recognizedEcuadorCaOidPrefixes = [
    '1.3.6.1.4.1.37947',
    '1.3.6.1.4.1.37746',
    '1.3.6.1.4.1.37442',
    '1.3.6.1.4.1.47286',
    '1.3.6.1.4.1.18332',
  ];

  extractAndValidate(
    p12Buffer: Buffer,
    password: string,
    options?: P12ValidationOptions,
  ): ParsedP12Material {
    if (!p12Buffer || p12Buffer.length === 0) {
      throw new BadRequestException('CERTIFICATE_EMPTY: El archivo .p12 está vacío.');
    }

    // 6. Contraseña: comprobar que permite acceder al archivo PKCS#12 (.p12 o .pfx)
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

    // 4. Integridad: comprobar que el certificado y su clave privada correspondan
    let selectedKey: forge.pki.rsa.PrivateKey | null = null;
    let selectedCert: forge.pki.Certificate | null = null;
    let foundSigningPair = false;

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
          pubKey.e &&
          candidateKey.e &&
          pubKey.n.compareTo(candidateKey.n) === 0 &&
          pubKey.e.compareTo(candidateKey.e) === 0
        ) {
          selectedKey = candidateKey;
          selectedCert = candidateCert;

          if (this.isSigningCertificate(candidateCert)) {
            foundSigningPair = true;
            break;
          }
        }
      }
      if (foundSigningPair) {
        break;
      }
    }

    if (!selectedKey || !selectedCert) {
      throw new BadRequestException(
        'CERTIFICATE_KEY_MISMATCH: El certificado X.509 y la clave privada del archivo .p12 no se corresponden.',
      );
    }

    this.verifyKeyPairCryptographicIntegrity(
      selectedKey,
      selectedCert.publicKey as forge.pki.rsa.PublicKey,
    );

    // 2. Vigencia: comprobar que no esté caducado ni fuera de ventana de validez
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

    // Format Issuer Name and Subject Name according to RFC 2253 (reverse order expected by SRI XAdES-BES)
    const issuerName = this.formatDistinguishedName(selectedCert.issuer.attributes);
    const subjectName = this.formatDistinguishedName(selectedCert.subject.attributes);

    // Convert Hex Serial Number to Decimal string for X509SerialNumber
    const cleanHexSerial =
      (selectedCert.serialNumber || '01').replace(/[^0-9a-fA-F]/g, '').toLowerCase() || '01';
    const serialNumberDec = BigInt(`0x${cleanHexSerial}`).toString(10);

    // 1. Entidad certificadora: comprobar que proviene de una entidad reconocida para facturación electrónica
    const shouldEnforceCa =
      options?.enforceAccreditedCa ?? process.env.ALLOW_UNRECOGNIZED_CA !== 'true';
    if (shouldEnforceCa && !this.isRecognizedCertificationAuthority(selectedCert, issuerName)) {
      throw new BadRequestException(
        `UNRECOGNIZED_CA_ISSUER: El certificado no proviene de una entidad certificadora acreditada y reconocida por el SRI (${issuerName}).`,
      );
    }

    // 3. Identidad: verificar que el certificado corresponda al RUC del emisor
    if (options?.expectedRuc) {
      this.verifyCertificateRucIdentity(selectedCert, options.expectedRuc);
    }

    // 5. Revocación (synchronous check against configured/supplied revoked serials + CRL URL extraction)
    const crlUrls = this.extractCrlUrls(selectedCert);
    this.verifyNotInRevokedList(cleanHexSerial, serialNumberDec, options?.revokedSerialNumbers);

    // Convert certificate to X.509 DER and Base64
    const certAsn1 = forge.pki.certificateToAsn1(selectedCert);
    const certDerBytes = forge.asn1.toDer(certAsn1).getBytes();
    const certDerBase64 = forge.util.encode64(certDerBytes);

    // Compute SHA-1 digest of the DER certificate
    const sha1Md = forge.md.sha1.create();
    sha1Md.update(certDerBytes);
    const certSha1Base64 = forge.util.encode64(sha1Md.digest().getBytes());

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
      serialNumberHex: cleanHexSerial,
      serialNumberDec,
      modulusBase64,
      exponentBase64,
      validFrom,
      validTo,
      crlUrls,
    };
  }

  /**
   * Non-destructive diagnostic inspection of a PKCS#12 (.p12/.pfx) digital certificate.
   * Returns a complete health report (CertificateDiagnosticDto) without throwing fatal HTTP exceptions.
   */
  inspectCertificate(
    p12Buffer: Buffer,
    password: string,
    options?: P12ValidationOptions,
  ): CertificateDiagnosticDto {
    const issues: DiagnosticIssueDto[] = [];

    if (!p12Buffer || p12Buffer.length === 0) {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_EMPTY,
        message: 'El archivo .p12 está vacío o no fue suministrado.',
        severity: 'ERROR',
        sriOfficialCode: 40,
        recommendedAction: 'Cargue un archivo PKCS#12 (.p12 o .pfx) válido.',
      });
      return {
        isValid: false,
        status: CertificateHealthStatus.CORRUPTED,
        isAccreditedCa: false,
        revocationStatus: RevocationStatus.INDETERMINATE,
        issues,
      };
    }

    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const derBytes = p12Buffer.toString('binary');
      const asn1 = forge.asn1.fromDer(derBytes);
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    } catch {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_INVALID_PASSWORD,
        message: 'No se pudo abrir el archivo .p12 con la contraseña suministrada.',
        severity: 'ERROR',
        sriOfficialCode: 40,
        recommendedAction: 'Verifique la contraseña de su firma electrónica.',
      });
      return {
        isValid: false,
        status: CertificateHealthStatus.INVALID_PASSWORD,
        isAccreditedCa: false,
        revocationStatus: RevocationStatus.INDETERMINATE,
        issues,
      };
    }

    // Extract private keys and certs
    const shroudedBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] || [];
    const plainKeyBags =
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    const allKeyBags = [...shroudedBags, ...plainKeyBags].filter((b) => b && b.key);

    if (allKeyBags.length === 0) {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_PRIVATE_KEY_NOT_FOUND,
        message: 'No se encontró la clave privada RSA en el archivo .p12.',
        severity: 'ERROR',
        sriOfficialCode: 40,
        recommendedAction: 'Asegúrese de exportar el certificado con su clave privada.',
      });
      return {
        isValid: false,
        status: CertificateHealthStatus.CORRUPTED,
        isAccreditedCa: false,
        revocationStatus: RevocationStatus.INDETERMINATE,
        issues,
      };
    }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const validCertBags = certBags.filter((b) => b && b.cert);

    if (validCertBags.length === 0) {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_NOT_FOUND,
        message: 'No se encontró ningún certificado X.509 en el archivo .p12.',
        severity: 'ERROR',
        sriOfficialCode: 40,
        recommendedAction: 'Exporte un archivo .p12 válido que contenga el certificado X.509.',
      });
      return {
        isValid: false,
        status: CertificateHealthStatus.CORRUPTED,
        isAccreditedCa: false,
        revocationStatus: RevocationStatus.INDETERMINATE,
        issues,
      };
    }

    // Match key pair
    let selectedKey: forge.pki.rsa.PrivateKey | null = null;
    let selectedCert: forge.pki.Certificate | null = null;
    let foundSigningPair = false;

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
          pubKey.e &&
          candidateKey.e &&
          pubKey.n.compareTo(candidateKey.n) === 0 &&
          pubKey.e.compareTo(candidateKey.e) === 0
        ) {
          selectedKey = candidateKey;
          selectedCert = candidateCert;
          if (this.isSigningCertificate(candidateCert)) {
            foundSigningPair = true;
            break;
          }
        }
      }
      if (foundSigningPair) break;
    }

    if (!selectedKey || !selectedCert) {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_KEY_MISMATCH,
        message: 'La clave privada y el certificado X.509 no se corresponden criptográficamente.',
        severity: 'ERROR',
        sriOfficialCode: 39,
        recommendedAction: 'Vuelva a exportar el certificado y la clave privada asociados.',
      });
      return {
        isValid: false,
        status: CertificateHealthStatus.CORRUPTED,
        isAccreditedCa: false,
        revocationStatus: RevocationStatus.INDETERMINATE,
        issues,
      };
    }

    // Issuer & Subject extraction
    const issuerName = this.formatDistinguishedName(selectedCert.issuer.attributes);
    const subjectName = this.formatDistinguishedName(selectedCert.subject.attributes);
    const isAccreditedCa = this.isRecognizedCertificationAuthority(selectedCert, issuerName);

    if (!isAccreditedCa) {
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_UNRECOGNIZED_CA,
        message: `La entidad emisora "${issuerName}" no está en el listado de CAs acreditadas por ARCOTEL / SRI.`,
        severity: 'WARNING',
        sriOfficialCode: 40,
        recommendedAction:
          'Asegúrese de adquirir una firma emitida por una entidad certificadora acreditada en Ecuador.',
      });
    }

    // Dates & status
    const now = new Date();
    const validFrom = selectedCert.validity.notBefore;
    const validTo = selectedCert.validity.notAfter;
    const daysRemaining = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let status = CertificateHealthStatus.VALID;
    if (now > validTo) {
      status = CertificateHealthStatus.EXPIRED;
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_EXPIRED,
        message: `El certificado caducó el ${validTo.toISOString()}.`,
        severity: 'ERROR',
        sriOfficialCode: 42,
        recommendedAction: 'Renueve su firma electrónica con su entidad certificadora.',
      });
    } else if (now < validFrom) {
      status = CertificateHealthStatus.NOT_YET_VALID;
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_NOT_YET_VALID,
        message: `El certificado aún no entra en vigencia (${validFrom.toISOString()}).`,
        severity: 'ERROR',
        sriOfficialCode: 40,
        recommendedAction: 'Espere a la fecha de inicio de vigencia del certificado.',
      });
    } else if (daysRemaining <= 30) {
      status = CertificateHealthStatus.EXPIRING_SOON;
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_EXPIRING_SOON,
        message: `El certificado caducará pronto (en ${daysRemaining} días).`,
        severity: 'WARNING',
        recommendedAction: 'Inicie el trámite de renovación de su firma electrónica.',
      });
    }

    // Metadata extraction (CN, RUC, Cedula, Representative)
    let representativeName: string | undefined;
    let subjectCedula: string | undefined;
    let subjectRuc: string | undefined;

    const candidateTexts: string[] = [];
    for (const attr of selectedCert.subject.attributes) {
      const val = String(attr.value || '');
      candidateTexts.push(val);
      if (attr.name === 'commonName' || attr.shortName === 'CN') {
        representativeName = val;
      }
      if (
        attr.shortName === 'SERIALNUMBER' ||
        attr.name === 'serialNumber' ||
        attr.type === '2.5.4.5'
      ) {
        const digits = val.replace(/\D/g, '');
        if (digits.length === 10) subjectCedula = digits;
        if (digits.length === 13) subjectRuc = digits;
      }
    }

    const extensions = (selectedCert.extensions || []) as Array<{ id?: string; value?: string }>;
    for (const ext of extensions) {
      if (typeof ext.value === 'string' && ext.value.length > 0) {
        const printable = ext.value.replace(/[^\x20-\x7E]/g, ' ');
        candidateTexts.push(printable);
      }
    }

    const combinedSubjectText = candidateTexts.join(' | ');

    if (!subjectRuc) {
      const rucMatch = combinedSubjectText.match(/\b\d{10}00[1-9]\b/);
      if (rucMatch) subjectRuc = rucMatch[0];
    }
    if (!subjectCedula) {
      const cedulaMatch = combinedSubjectText.match(/\b\d{10}\b/);
      if (cedulaMatch && cedulaMatch[0] !== subjectRuc?.slice(0, 10)) {
        subjectCedula = cedulaMatch[0];
      }
    }

    let isLegalRepresentative = false;
    if (
      /REPRESENTANTE\s*LEGAL|APODERADO|EMPRESA/i.test(combinedSubjectText) ||
      Boolean(subjectRuc && representativeName)
    ) {
      isLegalRepresentative = true;
    }

    // Expected RUC comparison
    let matchesIssuerRuc: boolean | undefined;
    if (options?.expectedRuc) {
      const cleanExpected = options.expectedRuc.trim();
      let matches = false;
      if (combinedSubjectText.includes(cleanExpected)) {
        matches = true;
      } else {
        const third = Number(cleanExpected[2]);
        const cedula = cleanExpected.slice(0, 10);
        if (third < 6 && cleanExpected.endsWith('001') && combinedSubjectText.includes(cedula)) {
          matches = true;
        }
      }

      matchesIssuerRuc = matches;
      if (!matches) {
        issues.push({
          code: DiagnosticErrorCode.CERTIFICATE_RUC_MISMATCH,
          message: `El certificado no coincide con el RUC del emisor (${cleanExpected}).`,
          severity: 'ERROR',
          sriOfficialCode: 39,
          recommendedAction: 'Cargue el archivo .p12 perteneciente al RUC emisor.',
        });
      }
    }

    // Revocation status
    const cleanHexSerial =
      (selectedCert.serialNumber || '01').replace(/[^0-9a-fA-F]/g, '').toLowerCase() || '01';
    const serialNumberDec = BigInt(`0x${cleanHexSerial}`).toString(10);

    let revocationStatus = RevocationStatus.ACTIVE;
    try {
      this.verifyNotInRevokedList(cleanHexSerial, serialNumberDec, options?.revokedSerialNumbers);
    } catch {
      revocationStatus = RevocationStatus.REVOKED;
      issues.push({
        code: DiagnosticErrorCode.CERTIFICATE_REVOKED,
        message: `El certificado (serie ${serialNumberDec}) figura como REVOCADO.`,
        severity: 'ERROR',
        sriOfficialCode: 42,
        recommendedAction: 'Adquiera una nueva firma electrónica ya que la actual fue revocada.',
      });
    }

    const hasFatal = issues.some((i) => i.severity === 'ERROR');

    return {
      isValid: !hasFatal,
      status,
      subject: subjectName,
      representativeName,
      isLegalRepresentative,
      subjectRuc,
      subjectCedula,
      issuer: issuerName,
      isAccreditedCa,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      daysRemaining,
      matchesIssuerRuc,
      revocationStatus,
      issues,
    };
  }

  /**
   * 5. Revocación (Online CRL verification when applicable):
   * Checks local revoked serials and, if the certificate includes HTTP/HTTPS CRL Distribution
   * Points (cRLDistributionPoints) and CRL checking is enabled, downloads and parses the X.509 CRL
   * to verify the certificate's serial number has not been revoked by the issuing CA.
   */
  async verifyRevocationStatus(
    cert: forge.pki.Certificate,
    options?: P12ValidationOptions,
  ): Promise<void> {
    const cleanHexSerial =
      (cert.serialNumber || '01').replace(/[^0-9a-fA-F]/g, '').toLowerCase() || '01';
    const serialNumberDec = BigInt(`0x${cleanHexSerial}`).toString(10);

    this.verifyNotInRevokedList(cleanHexSerial, serialNumberDec, options?.revokedSerialNumbers);

    if (process.env.CRL_CHECK_ENABLED === 'false') {
      return;
    }

    const crlUrls = this.extractCrlUrls(cert);
    if (crlUrls.length === 0) {
      return;
    }

    for (const crlUrl of crlUrls) {
      if (!this.isSafeCrlUrl(crlUrl)) {
        this.logger.warn(`IGNORING_UNSAFE_CRL_URL: URL CRL omitida por seguridad: ${crlUrl}`);
        continue;
      }

      try {
        const response = await axios.get<ArrayBuffer>(crlUrl, {
          responseType: 'arraybuffer',
          timeout: 5000,
          maxRedirects: 0,
        });
        const crlBuffer = Buffer.from(response.data);
        if (this.isSerialInCrlDer(crlBuffer, cleanHexSerial)) {
          throw new BadRequestException(
            `CERTIFICATE_REVOKED: El certificado digital (serie ${serialNumberDec}) figura como revocado en la lista CRL de la entidad certificadora (${crlUrl}).`,
          );
        }
        return;
      } catch (error: unknown) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        if (process.env.CRL_STRICT_MODE === 'true') {
          throw new BadRequestException(
            `CRL_CHECK_FAILED: No se pudo verificar el estado de revocación del certificado en ${crlUrl} (${errMsg}).`,
          );
        }
        this.logger.warn(
          `No se pudo descargar la lista CRL desde ${crlUrl} (${errMsg}). Continuando en modo tolerante a fallos de red de la CA.`,
        );
      }
    }
  }

  /**
   * Parses an X.509 CRL (DER or PEM) per RFC 5280 Section 5.1 and checks whether
   * the given certificate hex serial number appears inside TBSCertList.revokedCertificates.
   */
  isSerialInCrlDer(crlBuffer: Buffer, certSerialHex: string): boolean {
    const normalizedTarget = this.normalizeSerialHex(certSerialHex);
    if (!normalizedTarget) {
      return false;
    }

    let derBytes: string;
    const textSample = crlBuffer.subarray(0, 64).toString('utf8');
    if (textSample.includes('-----BEGIN X509 CRL-----')) {
      const pemText = crlBuffer.toString('utf8');
      const b64 = pemText
        .replace(/-----BEGIN X509 CRL-----/g, '')
        .replace(/-----END X509 CRL-----/g, '')
        .replace(/\s+/g, '');
      derBytes = forge.util.decode64(b64);
    } else {
      derBytes = crlBuffer.toString('binary');
    }

    const crlAsn1 = forge.asn1.fromDer(derBytes);
    if (!Array.isArray(crlAsn1.value) || crlAsn1.value.length === 0) {
      return false;
    }

    const tbsCertList = crlAsn1.value[0] as forge.asn1.Asn1;
    if (!Array.isArray(tbsCertList.value)) {
      return false;
    }

    // In RFC 5280 TBSCertList:
    // 1st Universal SEQUENCE = signature (AlgorithmIdentifier)
    // 2nd Universal SEQUENCE = issuer (Name)
    // 3rd Universal SEQUENCE = revokedCertificates (SEQUENCE OF SEQUENCE { userCertificate INTEGER, revocationDate Time, ... })
    const universalSequences = (tbsCertList.value as forge.asn1.Asn1[]).filter(
      (node) =>
        node.tagClass === forge.asn1.Class.UNIVERSAL && node.type === forge.asn1.Type.SEQUENCE,
    );

    if (universalSequences.length < 3) {
      return false;
    }

    const revokedCertsSeq = universalSequences[2];
    if (!Array.isArray(revokedCertsSeq.value)) {
      return false;
    }

    for (const entry of revokedCertsSeq.value as forge.asn1.Asn1[]) {
      if (
        entry.tagClass === forge.asn1.Class.UNIVERSAL &&
        entry.type === forge.asn1.Type.SEQUENCE &&
        Array.isArray(entry.value) &&
        entry.value.length > 0
      ) {
        const serialNode = entry.value[0] as forge.asn1.Asn1;
        if (
          serialNode.tagClass === forge.asn1.Class.UNIVERSAL &&
          serialNode.type === forge.asn1.Type.INTEGER &&
          typeof serialNode.value === 'string'
        ) {
          const entrySerialHex = this.normalizeSerialHex(forge.util.bytesToHex(serialNode.value));
          if (entrySerialHex === normalizedTarget) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private verifyKeyPairCryptographicIntegrity(
    privateKey: forge.pki.rsa.PrivateKey,
    publicKey: forge.pki.rsa.PublicKey,
  ): void {
    try {
      const challengeMd = forge.md.sha256.create();
      challengeMd.update('sri-invoice-gateway-keypair-integrity-check', 'utf8');
      const digestBytes = challengeMd.digest().getBytes();
      const signatureBytes = privateKey.sign(challengeMd);
      const isValid = publicKey.verify(digestBytes, signatureBytes);
      if (!isValid) {
        throw new Error('Signature verification returned false');
      }
    } catch {
      throw new BadRequestException(
        'CERTIFICATE_KEY_MISMATCH: Falló la prueba criptográfica de integridad entre el certificado y su clave privada.',
      );
    }
  }

  private isRecognizedCertificationAuthority(
    cert: forge.pki.Certificate,
    formattedIssuer: string,
  ): boolean {
    if (this.recognizedCaPatterns.some((pattern) => pattern.test(formattedIssuer))) {
      return true;
    }

    for (const attr of cert.issuer.attributes) {
      const val = String(attr.value || '');
      if (this.recognizedCaPatterns.some((pattern) => pattern.test(val))) {
        return true;
      }
    }

    const extensions = (cert.extensions || []) as Array<{ id?: string; value?: string }>;
    for (const ext of extensions) {
      const extOid = String(ext.id || '');
      if (this.recognizedEcuadorCaOidPrefixes.some((prefix) => extOid.startsWith(prefix))) {
        return true;
      }
    }

    return false;
  }

  private verifyCertificateRucIdentity(cert: forge.pki.Certificate, expectedRuc: string): void {
    const cleanRuc = expectedRuc.trim();
    if (!/^\d{13}$/.test(cleanRuc)) {
      throw new BadRequestException(
        `CERTIFICATE_RUC_MISMATCH: El RUC esperado (${expectedRuc}) no tiene un formato válido de 13 dígitos.`,
      );
    }

    const candidateTexts: string[] = [];

    for (const attr of cert.subject.attributes) {
      if (attr.value) {
        candidateTexts.push(String(attr.value));
      }
    }

    const extensions = (cert.extensions || []) as Array<{ id?: string; value?: string }>;
    for (const ext of extensions) {
      if (typeof ext.value === 'string' && ext.value.length > 0) {
        // Convert binary ASN.1 value to printable ASCII runs so embedded UTF8String/PrintableString OIDs are searchable
        const printable = ext.value.replace(/[^\x20-\x7E]/g, ' ');
        candidateTexts.push(printable);
      }
    }

    const combinedText = candidateTexts.join(' | ');

    // 1. Direct match on the 13-digit RUC in Subject attributes or Ecuadorian CA X.509 extensions
    if (combinedText.includes(cleanRuc)) {
      return;
    }

    // 2. Check if another conflicting 13-digit RUC (ending in 001..009) is present in the certificate
    const thirteenDigitMatches: string[] = combinedText.match(/\b\d{10}00[1-9]\b/g) ?? [];
    if (thirteenDigitMatches.length > 0 && !thirteenDigitMatches.includes(cleanRuc)) {
      throw new BadRequestException(
        `CERTIFICATE_RUC_MISMATCH: El certificado digital pertenece al RUC ${thirteenDigitMatches[0]} y no corresponde al RUC del emisor (${cleanRuc}).`,
      );
    }

    // 3. For natural person RUCs (third digit 0..5 and ending in 001), Ecuadorian CAs may store the 10-digit Cédula in SERIALNUMBER / OID
    const thirdDigit = Number(cleanRuc[2]);
    const cedulaPrefix = cleanRuc.slice(0, 10);
    if (thirdDigit >= 0 && thirdDigit <= 5 && cleanRuc.endsWith('001')) {
      if (combinedText.includes(cedulaPrefix)) {
        return;
      }
    }

    throw new BadRequestException(
      `CERTIFICATE_RUC_MISMATCH: El certificado digital no contiene ni corresponde al RUC del emisor (${cleanRuc}).`,
    );
  }

  private verifyNotInRevokedList(
    serialNumberHex: string,
    serialNumberDec: string,
    customRevokedList?: string[],
  ): void {
    const envRevoked = (process.env.REVOKED_CERT_SERIALS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const allRevoked = [...(customRevokedList || []), ...envRevoked];
    if (allRevoked.length === 0) {
      return;
    }

    const normalizedHex = this.normalizeSerialHex(serialNumberHex);
    for (const candidate of allRevoked) {
      const cleanCandidate = candidate.trim().toLowerCase();
      if (
        cleanCandidate === serialNumberDec ||
        this.normalizeSerialHex(cleanCandidate) === normalizedHex
      ) {
        throw new BadRequestException(
          `CERTIFICATE_REVOKED: El certificado digital (serie ${serialNumberDec}) se encuentra revocado.`,
        );
      }
    }
  }

  private extractCrlUrls(cert: forge.pki.Certificate): string[] {
    const urls = new Set<string>();
    const extensions = (cert.extensions || []) as Array<{
      id?: string;
      name?: string;
      value?: string;
    }>;

    for (const ext of extensions) {
      if (ext.name === 'cRLDistributionPoints' || ext.id === '2.5.29.31') {
        const rawValue = String(ext.value || '');
        const matches = rawValue.match(/https?:\/\/[^\x00-\x1F\x7F"'\s<>]+/gi) || [];
        for (const url of matches) {
          urls.add(url);
        }
      }
    }

    return Array.from(urls);
  }

  private normalizeSerialHex(hexOrDec: string): string {
    const cleaned = hexOrDec
      .replace(/^0x/i, '')
      .replace(/[^0-9a-fA-F]/g, '')
      .toLowerCase();
    return cleaned.replace(/^0+/, '') || '0';
  }

  private isSigningCertificate(cert: forge.pki.Certificate): boolean {
    const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | undefined;
    if (basicConstraints?.cA) {
      return false;
    }

    const keyUsage = cert.getExtension('keyUsage') as
      { digitalSignature?: boolean; nonRepudiation?: boolean } | undefined;
    if (keyUsage) {
      return Boolean(keyUsage.digitalSignature || keyUsage.nonRepudiation);
    }

    return true;
  }

  private isSafeCrlUrl(crlUrl: string): boolean {
    try {
      const parsed = new URL(crlUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '169.254.169.254' ||
        host.endsWith('.internal') ||
        host.endsWith('.local')
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
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
      '2.5.4.4': 'SN',
      '2.5.4.5': 'SERIALNUMBER',
      '2.5.4.6': 'C',
      '2.5.4.7': 'L',
      '2.5.4.8': 'ST',
      '2.5.4.9': 'STREET',
      '2.5.4.10': 'O',
      '2.5.4.11': 'OU',
      '2.5.4.12': 'T',
      '2.5.4.42': 'GIVENNAME',
      '2.5.4.97': '2.5.4.97',
      '1.2.840.113549.1.9.1': 'E',
    };
    return map[oid];
  }
}
