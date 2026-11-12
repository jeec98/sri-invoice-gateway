import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagnosticsService } from './diagnostics.service';
import { RucValidatorService } from './services/ruc-validator.service';
import { P12ParserService } from '../crypto/p12-parser.service';
import { SriSoapClientService } from '../sri-soap/sri-soap-client.service';
import { OverallDiagnosticStatus } from './constants/diagnostic-error-codes';
import { VerifySetupDto } from './dto/verify-setup.dto';

describe('DiagnosticsService', () => {
  let service: DiagnosticsService;
  let rucValidator: RucValidatorService;
  let p12Parser: P12ParserService;
  let sriSoapClient: SriSoapClientService;
  let prisma: any;
  let aesGcm: any;

  beforeEach(() => {
    rucValidator = new RucValidatorService();
    p12Parser = new P12ParserService();
    sriSoapClient = new SriSoapClientService();
    prisma = {
      tenant: { findFirst: vi.fn() },
      certificate: { findFirst: vi.fn() },
    };
    aesGcm = {
      decrypt: vi.fn(),
    };

    service = new DiagnosticsService(rucValidator, p12Parser, sriSoapClient, prisma, aesGcm);
  });

  describe('verifySetup (Stateless Preflight)', () => {
    it('debe devolver overallStatus: READY y canIssueInvoices: true cuando todos los subsistemas son válidos', async () => {
      vi.spyOn(sriSoapClient, 'checkConnectivity').mockResolvedValue({
        isReachable: true,
        latencyMs: 120,
        url: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...',
        issues: [],
      });

      // Mock inspectCertificate
      vi.spyOn(p12Parser, 'inspectCertificate').mockReturnValue({
        isValid: true,
        status: 'VALID' as any,
        isAccreditedCa: true,
        matchesIssuerRuc: true,
        daysRemaining: 180,
        revocationStatus: 'ACTIVE' as any,
        issues: [],
      });

      const dto: VerifySetupDto = {
        ruc: '1790016919001',
        password: 'ValidPassword',
        p12Base64: Buffer.from('synthetic-p12').toString('base64'),
        establishments: [{ codigo: '001', puntoEmision: '001', activo: true }],
      };

      const result = await service.verifySetup(dto);

      expect(result.overallStatus).toBe(OverallDiagnosticStatus.READY);
      expect(result.canIssueInvoices).toBe(true);
      expect(result.ruc.isValid).toBe(true);
      expect(result.certificate.isValid).toBe(true);
      expect(result.establishments[0].canInvoice).toBe(true);
      expect(result.summaryIssues).toHaveLength(0);
    });

    it('debe devolver overallStatus: FAILED y canIssueInvoices: false cuando el RUC es matemáticamente inválido', async () => {
      vi.spyOn(sriSoapClient, 'checkConnectivity').mockResolvedValue({
        isReachable: true,
        latencyMs: 100,
        issues: [],
      });

      vi.spyOn(p12Parser, 'inspectCertificate').mockReturnValue({
        isValid: true,
        status: 'VALID' as any,
        isAccreditedCa: true,
        matchesIssuerRuc: true,
        daysRemaining: 180,
        revocationStatus: 'ACTIVE' as any,
        issues: [],
      });

      const dto: VerifySetupDto = {
        ruc: '1790016918001', // Dígito verificador 8 inválido (debe ser 9)
        password: 'ValidPassword',
        p12Base64: Buffer.from('synthetic-p12').toString('base64'),
      };

      const result = await service.verifySetup(dto);

      expect(result.overallStatus).toBe(OverallDiagnosticStatus.FAILED);
      expect(result.canIssueInvoices).toBe(false);
      expect(result.ruc.isValid).toBe(false);
      expect(result.summaryIssues.length).toBeGreaterThan(0);
    });

    it('debe devolver overallStatus: DEGRADED pero canIssueInvoices: true cuando el SRI tiene timeout pero RUC y firma son válidos', async () => {
      vi.spyOn(sriSoapClient, 'checkConnectivity').mockResolvedValue({
        isReachable: false,
        latencyMs: 3500,
        issues: [
          {
            code: 'SRI_SOAP_TIMEOUT' as any,
            message: 'Timeout SRI',
            severity: 'WARNING',
          },
        ],
      });

      vi.spyOn(p12Parser, 'inspectCertificate').mockReturnValue({
        isValid: true,
        status: 'VALID' as any,
        isAccreditedCa: true,
        matchesIssuerRuc: true,
        daysRemaining: 180,
        revocationStatus: 'ACTIVE' as any,
        issues: [],
      });

      const dto: VerifySetupDto = {
        ruc: '1790016919001',
        password: 'ValidPassword',
        p12Base64: Buffer.from('synthetic-p12').toString('base64'),
      };

      const result = await service.verifySetup(dto);

      expect(result.overallStatus).toBe(OverallDiagnosticStatus.DEGRADED);
      expect(result.canIssueInvoices).toBe(true);
      expect(result.summaryIssues.some((i) => i.code === 'SRI_SOAP_TIMEOUT')).toBe(true);
    });
  });

  describe('diagnoseTenant & getTenantEligibility (Stateful)', () => {
    it('debe ejecutar diagnóstico de un tenant registrado descifrando su certificado', async () => {
      prisma.tenant.findFirst.mockResolvedValue({
        id: 'tenant-123',
        ruc: '1790016919001',
        businessName: 'EMPRESA TEST S.A.',
        certificates: [
          {
            id: 'cert-1',
            p12Binary: Buffer.from('test-cert'),
            passwordCiphertext: 'enc-pass',
            passwordIv: 'iv-pass',
            passwordAuthTag: 'tag-pass',
          },
        ],
      });

      aesGcm.decrypt.mockReturnValue('SecretPassword');

      vi.spyOn(sriSoapClient, 'checkConnectivity').mockResolvedValue({
        isReachable: true,
        latencyMs: 150,
        issues: [],
      });

      vi.spyOn(p12Parser, 'inspectCertificate').mockReturnValue({
        isValid: true,
        status: 'VALID' as any,
        isAccreditedCa: true,
        matchesIssuerRuc: true,
        daysRemaining: 180,
        revocationStatus: 'ACTIVE' as any,
        issues: [],
      });

      const diag = await service.diagnoseTenant('tenant-123', 'client-1');
      expect(diag.overallStatus).toBe(OverallDiagnosticStatus.READY);
      expect(diag.canIssueInvoices).toBe(true);
      expect(diag.ruc.ruc).toBe('1790016919001');

      const eligibility = await service.getTenantEligibility('tenant-123', 'client-1');
      expect(eligibility.canIssueInvoices).toBe(true);
      expect(eligibility.overallStatus).toBe(OverallDiagnosticStatus.READY);
      expect(eligibility.checks.certificateValid).toBe(true);
      expect(eligibility.blockers).toHaveLength(0);
    });

    it('debe arrojar NotFoundException si el tenant no existe', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.diagnoseTenant('not-found', 'client-1')).rejects.toThrow(
        /no encontrado/,
      );
    });
  });
});
