import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { P12ParserService } from '../crypto/p12-parser.service';
import { SriSoapClientService } from '../sri-soap/sri-soap-client.service';
import { RucValidatorService } from './services/ruc-validator.service';
import {
  DiagnosticErrorCode,
  EstablishmentHealthStatus,
  OverallDiagnosticStatus,
} from './constants/diagnostic-error-codes';
import { VerifySetupDto } from './dto/verify-setup.dto';
import {
  CertificateDiagnosticDto,
  DiagnosticIssueDto,
  DiagnosticResponseDto,
  EstablishmentDiagnosticDto,
  RucDiagnosticDto,
  SriConnectivityDto,
  TenantEligibilitySummaryDto,
} from './dto/diagnostic-response.dto';

@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);

  constructor(
    private readonly rucValidator: RucValidatorService,
    private readonly p12Parser: P12ParserService,
    private readonly sriSoapClient: SriSoapClientService,
    private readonly prisma: PrismaService,
    private readonly aesGcm: AesGcmService,
  ) {}

  /**
   * Stateless preflight diagnostic check.
   * Evaluates RUC, PKCS#12 certificate, establishment matrix, and SRI connectivity 100% in memory.
   */
  async verifySetup(dto: VerifySetupDto, p12FileBuffer?: Buffer): Promise<DiagnosticResponseDto> {
    const evaluatedAt = new Date().toISOString();

    // 1. RUC Validation
    const rucResult: RucDiagnosticDto = this.rucValidator.validate(dto.ruc);

    // 2. PKCS#12 Certificate Inspection
    let certBuffer: Buffer | null = p12FileBuffer ?? null;
    if (!certBuffer && dto.p12Base64) {
      try {
        certBuffer = Buffer.from(dto.p12Base64.trim(), 'base64');
      } catch {
        certBuffer = null;
      }
    }

    let certificateResult: CertificateDiagnosticDto;
    if (certBuffer && certBuffer.length > 0) {
      certificateResult = this.p12Parser.inspectCertificate(certBuffer, dto.password, {
        expectedRuc: rucResult.isValid ? dto.ruc : undefined,
      });
    } else {
      certificateResult = {
        isValid: false,
        status: 'CORRUPTED' as any,
        isAccreditedCa: false,
        revocationStatus: 'INDETERMINATE' as any,
        issues: [
          {
            code: DiagnosticErrorCode.CERTIFICATE_EMPTY,
            message:
              'No se suministró el archivo de certificado digital (.p12 en base64 o archivo multipart).',
            severity: 'ERROR',
            sriOfficialCode: 40,
            recommendedAction: 'Proporcione el archivo .p12 o su contenido en base64.',
          },
        ],
      };
    }

    // 3. Establishments Matrix Evaluation
    const establishmentsResult = this.evaluateEstablishments(dto.establishments);

    // 4. SRI SOAP Connectivity
    const [connPruebas, connProd] = await Promise.all([
      this.sriSoapClient.checkConnectivity('1'),
      this.sriSoapClient.checkConnectivity('2'),
    ]);

    const sriConnectivity: SriConnectivityDto = {
      ambientePruebas: connPruebas,
      ambienteProduccion: connProd,
    };

    // 5. Aggregate Summary Issues
    const summaryIssues: DiagnosticIssueDto[] = [
      ...rucResult.issues,
      ...certificateResult.issues,
      ...establishmentsResult.flatMap((e) => e.issues),
      ...(dto.ambiente === '2' ? connProd.issues : connPruebas.issues),
    ];

    // 6. Compute Traffic-Light Semáforo
    const { overallStatus, canIssueInvoices } = this.computeOverallStatus(
      rucResult,
      certificateResult,
      establishmentsResult,
      dto.ambiente === '2' ? connProd : connPruebas,
    );

    return {
      overallStatus,
      canIssueInvoices,
      evaluatedAt,
      ruc: rucResult,
      certificate: certificateResult,
      establishments: establishmentsResult,
      sriConnectivity,
      summaryIssues,
    };
  }

  /**
   * Stateful diagnostic check for an existing registered Tenant.
   * Fetches tenant credentials, decrypts certificate using AES-256-GCM and executes full diagnostics.
   */
  async diagnoseTenant(tenantId: string, apiClientId: string): Promise<DiagnosticResponseDto> {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        id: tenantId,
        apiClientId,
      },
      include: {
        certificates: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con id "${tenantId}" no encontrado.`);
    }

    const activeCert = tenant.certificates[0];
    let certBuffer: Buffer | undefined;
    let certPassword = '';

    if (activeCert) {
      try {
        if (activeCert.p12Binary) {
          certBuffer = Buffer.from(activeCert.p12Binary);
        } else if (activeCert.p12FilePath) {
          const fs = await import('node:fs/promises');
          certBuffer = await fs.readFile(activeCert.p12FilePath);
        }

        if (activeCert.passwordCiphertext && activeCert.passwordIv && activeCert.passwordAuthTag) {
          certPassword = this.aesGcm.decrypt(
            activeCert.passwordCiphertext,
            activeCert.passwordIv,
            activeCert.passwordAuthTag,
          );
        }
      } catch (err: any) {
        this.logger.error(`Error descifrando certificado para tenant ${tenantId}: ${err.message}`);
      }
    }

    const defaultEstablishment = {
      codigo: '001',
      puntoEmision: '001',
      nombre: 'Matriz Principal',
      activo: true,
    };

    return this.verifySetup(
      {
        ruc: tenant.ruc,
        password: certPassword,
        ambiente: '1',
        establishments: [defaultEstablishment],
      },
      certBuffer,
    );
  }

  /**
   * Fast eligibility check returning a lightweight summary.
   */
  async getTenantEligibility(
    tenantId: string,
    apiClientId: string,
  ): Promise<TenantEligibilitySummaryDto> {
    const fullDiag = await this.diagnoseTenant(tenantId, apiClientId);

    const blockers: string[] = fullDiag.summaryIssues
      .filter((i) => i.severity === 'ERROR')
      .map((i) => i.message);

    const activeEstablishments = fullDiag.establishments.filter((e) => e.canInvoice).length;
    const isTargetEnvOnline =
      fullDiag.sriConnectivity.ambientePruebas.isReachable ||
      fullDiag.sriConnectivity.ambienteProduccion.isReachable;

    return {
      tenantId,
      ruc: fullDiag.ruc.ruc,
      canIssueInvoices: fullDiag.canIssueInvoices,
      overallStatus: fullDiag.overallStatus,
      checks: {
        rucValid: fullDiag.ruc.isValid,
        certificateValid: fullDiag.certificate.isValid,
        certificateDaysRemaining: fullDiag.certificate.daysRemaining,
        activeEstablishments,
        sriOnline: isTargetEnvOnline,
      },
      blockers,
    };
  }

  private evaluateEstablishments(
    inputs?: Array<{
      codigo: string;
      puntoEmision: string;
      nombre?: string;
      direccion?: string;
      activo?: boolean;
    }>,
  ): EstablishmentDiagnosticDto[] {
    const establishments =
      inputs && inputs.length > 0
        ? inputs
        : [{ codigo: '001', puntoEmision: '001', nombre: 'Matriz Principal', activo: true }];

    return establishments.map((estab) => {
      const issues: DiagnosticIssueDto[] = [];
      const codigo = estab.codigo?.trim() || '';
      const puntoEmision = estab.puntoEmision?.trim() || '';

      if (!/^\d{3}$/.test(codigo)) {
        issues.push({
          code: DiagnosticErrorCode.ESTABLISHMENT_INVALID_CODE_FORMAT,
          message: `Código de establecimiento "${codigo}" debe tener exactamente 3 dígitos numéricos.`,
          severity: 'ERROR',
          recommendedAction:
            'Ajuste el código de establecimiento a formato de 3 dígitos (ej. 001).',
        });
      }

      if (!/^\d{3}$/.test(puntoEmision)) {
        issues.push({
          code: DiagnosticErrorCode.ESTABLISHMENT_INVALID_POINT_FORMAT,
          message: `Código de punto de emisión "${puntoEmision}" debe tener exactamente 3 dígitos numéricos.`,
          severity: 'ERROR',
          recommendedAction: 'Ajuste el punto de emisión a formato de 3 dígitos (ej. 001).',
        });
      }

      let status = EstablishmentHealthStatus.ACTIVO;
      let canInvoice = true;

      if (estab.activo === false) {
        status = EstablishmentHealthStatus.CERRADO;
        canInvoice = false;
        issues.push({
          code: DiagnosticErrorCode.ESTABLISHMENT_CLOSED,
          message: `El establecimiento ${codigo}-${puntoEmision} se encuentra marcado como cerrado o inactivo.`,
          severity: 'WARNING',
          sriOfficialCode: 56,
          recommendedAction: 'Reactive la sucursal en el portal del SRI para habilitar la emisión.',
        });
      }

      if (issues.some((i) => i.severity === 'ERROR')) {
        canInvoice = false;
      }

      return {
        codigo,
        puntoEmision,
        nombre: estab.nombre,
        canInvoice,
        status,
        issues,
      };
    });
  }

  private computeOverallStatus(
    ruc: RucDiagnosticDto,
    cert: CertificateDiagnosticDto,
    establishments: EstablishmentDiagnosticDto[],
    sriEnvConn: { isReachable: boolean; issues: DiagnosticIssueDto[] },
  ): { overallStatus: OverallDiagnosticStatus; canIssueInvoices: boolean } {
    const hasRucFatal = !ruc.isValid;
    const hasCertFatal = !cert.isValid || cert.status === 'EXPIRED';
    const hasNoActiveEstablishment = !establishments.some((e) => e.canInvoice);

    if (hasRucFatal || hasCertFatal || hasNoActiveEstablishment) {
      return {
        overallStatus: OverallDiagnosticStatus.FAILED,
        canIssueInvoices: false,
      };
    }

    const hasWarnings =
      cert.status === 'EXPIRING_SOON' ||
      !cert.isAccreditedCa ||
      !sriEnvConn.isReachable ||
      establishments.some((e) => !e.canInvoice);

    if (hasWarnings) {
      return {
        overallStatus: OverallDiagnosticStatus.DEGRADED,
        canIssueInvoices: true,
      };
    }

    return {
      overallStatus: OverallDiagnosticStatus.READY,
      canIssueInvoices: true,
    };
  }
}
