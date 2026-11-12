import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CertificateHealthStatus,
  DiagnosticErrorCode,
  EstablishmentHealthStatus,
  OverallDiagnosticStatus,
  RevocationStatus,
  RucType,
} from '../constants/diagnostic-error-codes';

export class DiagnosticIssueDto {
  @ApiProperty({
    enum: DiagnosticErrorCode,
    example: DiagnosticErrorCode.INVALID_RUC_CHECK_DIGIT,
    description: 'Código estandarizado del error o advertencia',
  })
  code!: DiagnosticErrorCode;

  @ApiProperty({
    example: 'El dígito verificador del RUC no coincide con el algoritmo Módulo 11.',
    description: 'Descripción legible del problema detectado',
  })
  message!: string;

  @ApiProperty({
    enum: ['ERROR', 'WARNING'],
    example: 'ERROR',
    description: 'Severidad del problema: ERROR (impide emisión) o WARNING (advertencia)',
  })
  severity!: 'ERROR' | 'WARNING';

  @ApiPropertyOptional({
    example: 10,
    description: 'Código de error oficial del SRI correlacionado si aplica',
  })
  sriOfficialCode?: number;

  @ApiPropertyOptional({
    example: 'Verifique los dígitos del RUC ingresado.',
    description: 'Recomendación operativa para solventar el problema',
  })
  recommendedAction?: string;
}

export class RucDiagnosticDto {
  @ApiProperty({ example: '1792147820001', description: 'RUC analizado' })
  ruc!: string;

  @ApiProperty({
    example: true,
    description: 'Indica si el RUC cumple con el algoritmo tributario del SRI',
  })
  isValid!: boolean;

  @ApiProperty({
    enum: RucType,
    example: RucType.SOCIEDAD_PRIVADA,
    description: 'Tipo de contribuyente detectado a partir del 3er dígito y provincia',
  })
  type!: RucType;

  @ApiProperty({ example: '17', description: 'Código de provincia detectado (01 a 24, o 30)' })
  provinceCode!: string;

  @ApiProperty({ example: 'Pichincha', description: 'Nombre de la provincia correspondiente' })
  provinceName!: string;

  @ApiProperty({
    type: [DiagnosticIssueDto],
    description: 'Lista de problemas encontrados durante la validación del RUC',
  })
  issues!: DiagnosticIssueDto[];
}

export class CertificateDiagnosticDto {
  @ApiProperty({
    example: true,
    description: 'Indica si el archivo .p12 se pudo descifrar y es técnicamente válido',
  })
  isValid!: boolean;

  @ApiProperty({
    enum: CertificateHealthStatus,
    example: CertificateHealthStatus.VALID,
    description: 'Estado de salud del certificado digital',
  })
  status!: CertificateHealthStatus;

  @ApiPropertyOptional({
    example: 'CN=JUAN PEREZ (RUC 1792147820001), OU=ENTIDAD DE CERTIFICACION, O=SECURITY DATA S.A.',
    description: 'Distinguished Name del Subject del certificado',
  })
  subject?: string;

  @ApiPropertyOptional({
    example: 'JUAN ALBERTO PEREZ LOPEZ',
    description: 'Nombre del titular o persona natural que firma en el certificado',
  })
  representativeName?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Indica si el certificado fue emitido a un Representante Legal o Apoderado de una empresa',
  })
  isLegalRepresentative?: boolean;

  @ApiPropertyOptional({
    example: '1792147820001',
    description: 'RUC de la empresa extraído del certificado si está presente',
  })
  subjectRuc?: string;

  @ApiPropertyOptional({
    example: '1712345678',
    description: 'Cédula del firmante extraída del certificado',
  })
  subjectCedula?: string;

  @ApiPropertyOptional({
    example: 'SECURITY DATA S.A. 2',
    description: 'Nombre de la Autoridad de Certificación (CA) emisora',
  })
  issuer?: string;

  @ApiProperty({
    example: true,
    description:
      'Indica si la CA emisora está formalmente acreditada ante ARCOTEL y aceptada por el SRI',
  })
  isAccreditedCa!: boolean;

  @ApiPropertyOptional({
    example: '2025-01-15T10:00:00.000Z',
    description: 'Fecha de inicio de vigencia del certificado (notBefore)',
  })
  validFrom?: string;

  @ApiPropertyOptional({
    example: '2027-01-15T10:00:00.000Z',
    description: 'Fecha de caducidad del certificado (notAfter)',
  })
  validTo?: string;

  @ApiPropertyOptional({
    example: 320,
    description: 'Días calendario restantes de vigencia antes de caducar',
  })
  daysRemaining?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Indica si el RUC del emisor coincide con el RUC o cédula registrado en el certificado',
  })
  matchesIssuerRuc?: boolean;

  @ApiProperty({
    enum: RevocationStatus,
    example: RevocationStatus.ACTIVE,
    description:
      'Estado de revocación: ACTIVE (válido), REVOKED (revocado), INDETERMINATE (sin respuesta OCSP/CRL)',
  })
  revocationStatus!: RevocationStatus;

  @ApiProperty({
    type: [DiagnosticIssueDto],
    description: 'Lista de problemas encontrados en la inspección del certificado',
  })
  issues!: DiagnosticIssueDto[];
}

export class EstablishmentDiagnosticDto {
  @ApiProperty({ example: '001', description: 'Código del establecimiento (3 dígitos)' })
  codigo!: string;

  @ApiProperty({ example: '001', description: 'Punto de emisión (3 dígitos)' })
  puntoEmision!: string;

  @ApiPropertyOptional({ example: 'Matriz - Centro', description: 'Nombre descriptivo del local' })
  nombre?: string;

  @ApiProperty({
    example: true,
    description: 'Indica si el establecimiento y punto de emisión están habilitados para facturar',
  })
  canInvoice!: boolean;

  @ApiProperty({
    enum: EstablishmentHealthStatus,
    example: EstablishmentHealthStatus.ACTIVO,
    description: 'Estado operativo del establecimiento',
  })
  status!: EstablishmentHealthStatus;

  @ApiProperty({
    type: [DiagnosticIssueDto],
    description: 'Problemas o advertencias asociadas a este establecimiento',
  })
  issues!: DiagnosticIssueDto[];
}

export class EnvironmentConnectivityDto {
  @ApiProperty({
    example: true,
    description: 'Indica si el servicio web SOAP del SRI respondió con éxito',
  })
  isReachable!: boolean;

  @ApiPropertyOptional({
    example: 145,
    description: 'Latencia de red de ida y vuelta en milisegundos',
  })
  latencyMs?: number;

  @ApiPropertyOptional({
    example: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...',
    description: 'Endpoint WSDL consultado',
  })
  url?: string;

  @ApiPropertyOptional({
    example: 'HTTP 200 OK',
    description: 'Resumen del estado devuelto por el servidor',
  })
  details?: string;

  @ApiProperty({
    type: [DiagnosticIssueDto],
    description: 'Problemas de conectividad o timeouts detectados',
  })
  issues!: DiagnosticIssueDto[];
}

export class SriConnectivityDto {
  @ApiProperty({ description: 'Conectividad con el ambiente de Pruebas (celcer)' })
  ambientePruebas!: EnvironmentConnectivityDto;

  @ApiProperty({ description: 'Conectividad con el ambiente de Producción (cel)' })
  ambienteProduccion!: EnvironmentConnectivityDto;
}

export class DiagnosticResponseDto {
  @ApiProperty({
    enum: OverallDiagnosticStatus,
    example: OverallDiagnosticStatus.READY,
    description:
      'Semáforo global: READY (apto para emitir), DEGRADED (emite con advertencias), FAILED (bloqueado)',
  })
  overallStatus!: OverallDiagnosticStatus;

  @ApiProperty({
    example: true,
    description:
      'Bandera determinante: true si el contribuyente puede facturar inmediatamente hacia el SRI',
  })
  canIssueInvoices!: boolean;

  @ApiProperty({
    example: '2026-11-12T20:45:00.000Z',
    description: 'Fecha y hora en que se ejecutó el diagnóstico',
  })
  evaluatedAt!: string;

  @ApiProperty({ description: 'Diagnóstico detallado del número de RUC' })
  ruc!: RucDiagnosticDto;

  @ApiProperty({ description: 'Diagnóstico criptográfico del certificado digital .p12' })
  certificate!: CertificateDiagnosticDto;

  @ApiProperty({
    type: [EstablishmentDiagnosticDto],
    description: 'Diagnóstico de la matriz de establecimientos y puntos de emisión',
  })
  establishments!: EstablishmentDiagnosticDto[];

  @ApiProperty({ description: 'Diagnóstico de conectividad con los Web Services del SRI' })
  sriConnectivity!: SriConnectivityDto;

  @ApiProperty({
    type: [DiagnosticIssueDto],
    description: 'Resumen consolidado de todos los errores y advertencias de todos los subsistemas',
  })
  summaryIssues!: DiagnosticIssueDto[];
}

export class TenantEligibilitySummaryDto {
  @ApiProperty({ example: 'tenant-uuid-1', description: 'Identificador del tenant evaluado' })
  tenantId!: string;

  @ApiProperty({ example: '1792147820001', description: 'RUC del tenant' })
  ruc!: string;

  @ApiProperty({
    example: true,
    description:
      'Indica si la empresa está técnicamente apta para emitir comprobantes en este momento',
  })
  canIssueInvoices!: boolean;

  @ApiProperty({
    enum: OverallDiagnosticStatus,
    example: OverallDiagnosticStatus.READY,
    description: 'Estado global de salud técnica',
  })
  overallStatus!: OverallDiagnosticStatus;

  @ApiProperty({
    example: {
      rucValid: true,
      certificateValid: true,
      certificateDaysRemaining: 320,
      activeEstablishments: 2,
      sriOnline: true,
    },
    description: 'Matriz ejecutiva de indicadores clave',
  })
  checks!: {
    rucValid: boolean;
    certificateValid: boolean;
    certificateDaysRemaining?: number;
    activeEstablishments: number;
    sriOnline: boolean;
  };

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Lista de motivos bloqueantes en caso de no poder emitir',
  })
  blockers!: string[];
}
