export enum OverallDiagnosticStatus {
  READY = 'READY',
  DEGRADED = 'DEGRADED',
  FAILED = 'FAILED',
}

export enum RucType {
  PERSONA_NATURAL = 'PERSONA_NATURAL',
  SOCIEDAD_PRIVADA = 'SOCIEDAD_PRIVADA',
  SOCIEDAD_PUBLICA = 'SOCIEDAD_PUBLICA',
  INVALID = 'INVALID',
}

export enum CertificateHealthStatus {
  VALID = 'VALID',
  EXPIRING_SOON = 'EXPIRING_SOON',
  EXPIRED = 'EXPIRED',
  NOT_YET_VALID = 'NOT_YET_VALID',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  CORRUPTED = 'CORRUPTED',
  UNRECOGNIZED_CA = 'UNRECOGNIZED_CA',
}

export enum RevocationStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  INDETERMINATE = 'INDETERMINATE',
}

export enum EstablishmentHealthStatus {
  ACTIVO = 'ACTIVO',
  CERRADO = 'CERRADO',
  CLAUSURADO = 'CLAUSURADO',
  DESCONOCIDO = 'DESCONOCIDO',
}

export enum DiagnosticErrorCode {
  // RUC Errors
  INVALID_RUC_LENGTH = 'INVALID_RUC_LENGTH',
  INVALID_RUC_PROVINCE = 'INVALID_RUC_PROVINCE',
  INVALID_RUC_THIRD_DIGIT = 'INVALID_RUC_THIRD_DIGIT',
  INVALID_RUC_CHECK_DIGIT = 'INVALID_RUC_CHECK_DIGIT',
  INVALID_RUC_ESTABLISHMENT_SUFFIX = 'INVALID_RUC_ESTABLISHMENT_SUFFIX',

  // Certificate Errors
  CERTIFICATE_EMPTY = 'CERTIFICATE_EMPTY',
  CERTIFICATE_INVALID_PASSWORD = 'CERTIFICATE_INVALID_PASSWORD',
  CERTIFICATE_PRIVATE_KEY_NOT_FOUND = 'CERTIFICATE_PRIVATE_KEY_NOT_FOUND',
  CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND',
  CERTIFICATE_KEY_MISMATCH = 'CERTIFICATE_KEY_MISMATCH',
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',
  CERTIFICATE_NOT_YET_VALID = 'CERTIFICATE_NOT_YET_VALID',
  CERTIFICATE_EXPIRING_SOON = 'CERTIFICATE_EXPIRING_SOON',
  CERTIFICATE_UNRECOGNIZED_CA = 'CERTIFICATE_UNRECOGNIZED_CA',
  CERTIFICATE_RUC_MISMATCH = 'CERTIFICATE_RUC_MISMATCH',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  CERTIFICATE_REVOCATION_INDETERMINATE = 'CERTIFICATE_REVOCATION_INDETERMINATE',

  // Establishment Errors
  ESTABLISHMENT_INVALID_CODE_FORMAT = 'ESTABLISHMENT_INVALID_CODE_FORMAT',
  ESTABLISHMENT_INVALID_POINT_FORMAT = 'ESTABLISHMENT_INVALID_POINT_FORMAT',
  ESTABLISHMENT_CLOSED = 'ESTABLISHMENT_CLOSED',
  ESTABLISHMENT_SHUTDOWN = 'ESTABLISHMENT_SHUTDOWN',

  // SRI Web Services & Connectivity Errors
  SRI_SOAP_UNREACHABLE = 'SRI_SOAP_UNREACHABLE',
  SRI_SOAP_TIMEOUT = 'SRI_SOAP_TIMEOUT',

  // SRI Official Rejection Codes (Ficha Técnica v2.34)
  SRI_OFFICIAL_2_RUC_INACTIVO = 'SRI_OFFICIAL_2_RUC_INACTIVO',
  SRI_OFFICIAL_10_ESTABLECIMIENTO_CLAUSURADO = 'SRI_OFFICIAL_10_ESTABLECIMIENTO_CLAUSURADO',
  SRI_OFFICIAL_37_RUC_NO_AUTORIZADO = 'SRI_OFFICIAL_37_RUC_NO_AUTORIZADO',
  SRI_OFFICIAL_39_FIRMA_INVALIDA = 'SRI_OFFICIAL_39_FIRMA_INVALIDA',
  SRI_OFFICIAL_40_ERROR_CERTIFICADO = 'SRI_OFFICIAL_40_ERROR_CERTIFICADO',
  SRI_OFFICIAL_42_FIRMA_REVOCADA_O_CADUCADA = 'SRI_OFFICIAL_42_FIRMA_REVOCADA_O_CADUCADA',
  SRI_OFFICIAL_46_RUC_NO_EXISTE = 'SRI_OFFICIAL_46_RUC_NO_EXISTE',
  SRI_OFFICIAL_56_ESTABLECIMIENTO_CERRADO = 'SRI_OFFICIAL_56_ESTABLECIMIENTO_CERRADO',
  SRI_OFFICIAL_63_RUC_PASIVO = 'SRI_OFFICIAL_63_RUC_PASIVO',
}

export interface SriOfficialErrorMapping {
  sriCode: number;
  diagnosticCode: DiagnosticErrorCode;
  message: string;
  recommendedAction: string;
}

export const SRI_OFFICIAL_ERROR_CATALOG: Record<number, SriOfficialErrorMapping> = {
  2: {
    sriCode: 2,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_2_RUC_INACTIVO,
    message: 'RUC del emisor se encuentra NO ACTIVO en la base tributaria del SRI.',
    recommendedAction:
      'Reactivar el RUC en el portal del SRI antes de intentar emitir comprobantes.',
  },
  10: {
    sriCode: 10,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_10_ESTABLECIMIENTO_CLAUSURADO,
    message: 'El establecimiento del emisor se encuentra CLAUSURADO por el SRI.',
    recommendedAction:
      'Acudir al SRI para solventar la clausura administrativa o emitir desde otro establecimiento activo.',
  },
  37: {
    sriCode: 37,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_37_RUC_NO_AUTORIZADO,
    message: 'El RUC no cuenta con autorización para emitir comprobantes electrónicos.',
    recommendedAction:
      'Solicitar y configurar la autorización de facturación electrónica en SRI en Línea.',
  },
  39: {
    sriCode: 39,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_39_FIRMA_INVALIDA,
    message: 'Firma electrónica inválida o no corresponde al estándar XAdES-BES.',
    recommendedAction: 'Verificar la integridad del archivo .p12 y regenerar la firma electrónica.',
  },
  40: {
    sriCode: 40,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_40_ERROR_CERTIFICADO,
    message: 'Error en la estructura del certificado digital (no cumple con X.509 estándar).',
    recommendedAction:
      'Renovar o exportar nuevamente el certificado digital desde la entidad certificadora acreditada.',
  },
  42: {
    sriCode: 42,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_42_FIRMA_REVOCADA_O_CADUCADA,
    message: 'La firma electrónica se encuentra revocada por la CA o ha caducado.',
    recommendedAction:
      'Adquirir o renovar la firma electrónica ante una entidad acreditada por ARCOTEL.',
  },
  46: {
    sriCode: 46,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_46_RUC_NO_EXISTE,
    message: 'El número de RUC no consta en el padrón del SRI.',
    recommendedAction:
      'Verificar que los 13 dígitos numéricos correspondan exactamente al RUC otorgado por el SRI.',
  },
  56: {
    sriCode: 56,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_56_ESTABLECIMIENTO_CERRADO,
    message: 'El establecimiento del emisor se encuentra CERRADO o dado de baja.',
    recommendedAction:
      'Reabrir el establecimiento en el portal del SRI o emitir desde una serie activa.',
  },
  63: {
    sriCode: 63,
    diagnosticCode: DiagnosticErrorCode.SRI_OFFICIAL_63_RUC_PASIVO,
    message: 'El RUC del emisor se encuentra en estado pasivo o suspendido definitivamente.',
    recommendedAction: 'Regularizar obligaciones tributarias pendientes para reactivar el RUC.',
  },
};
