export const UNIFIED_PLAN_LIMITS = {
  rateLimitRps: 20,
} as const;

export interface SaasFormInput {
  name: string;
  ruc: string;
  webhookUrl: string;
}

export interface SaasPayloadDto {
  name: string;
  ruc: string;
  webhookUrl?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof SaasFormInput, string>>;
}

export function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

export function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidProviderRuc(rawRuc: string): boolean {
  return /^\d{10}001$/.test(rawRuc.trim());
}

export function validateSaasForm(input: SaasFormInput): ValidationResult {
  const errors: Partial<Record<keyof SaasFormInput, string>> = {};

  if (!input.name || !input.name.trim()) {
    errors.name = 'El nombre de tu plataforma SaaS es obligatorio.';
  }

  const cleanRuc = input.ruc.trim();
  if (!cleanRuc) {
    errors.ruc = 'El RUC del proveedor SaaS es obligatorio (13 dígitos).';
  } else if (!isValidProviderRuc(cleanRuc)) {
    errors.ruc = 'El RUC debe tener exactamente 13 dígitos numéricos y terminar en 001.';
  }

  const cleanWebhook = input.webhookUrl.trim();
  if (cleanWebhook && !isValidHttpUrl(cleanWebhook)) {
    errors.webhookUrl = 'Si indicas un Webhook URL, debe comenzar con https:// o http://.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function buildRegistrationPayload(input: SaasFormInput): SaasPayloadDto {
  const payload: SaasPayloadDto = {
    name: input.name.trim(),
    ruc: input.ruc.trim(),
  };

  const cleanWebhook = input.webhookUrl.trim();
  if (cleanWebhook) {
    payload.webhookUrl = cleanWebhook;
  }

  return payload;
}

export function buildRegistrationEndpoint(apiBaseUrl: string): string {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (base.endsWith('/v1')) {
    return `${base}/api-clients`;
  }
  return `${base}/v1/api-clients`;
}
