export type SaasPlan = 'STANDARD' | 'PRO' | 'ENTERPRISE';

export interface SaasPlanMeta {
  id: SaasPlan;
  label: string;
  recommendedRps: number;
  summary: string;
}

export const SAAS_PLANS: Record<SaasPlan, SaasPlanMeta> = {
  STANDARD: {
    id: 'STANDARD',
    label: 'STANDARD (Base)',
    recommendedRps: 100,
    summary: 'Ideal para SaaS iniciales o integración de un negocio (100 req/s recomendados).',
  },
  PRO: {
    id: 'PRO',
    label: 'PRO (Crecimiento)',
    recommendedRps: 250,
    summary: 'Para ERPs y plataformas con decenas/cientos de emisores (250–500 req/s).',
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    label: 'ENTERPRISE (Alto Volumen)',
    recommendedRps: 500,
    summary: 'Plataformas masivas, retail o integradores de alto tráfico (hasta 1000 req/s).',
  },
};

export interface SaasFormInput {
  name: string;
  ruc: string;
  webhookUrl: string;
  plan: SaasPlan;
  rateLimitRps: number;
}

export interface SaasPayloadDto {
  name: string;
  ruc: string;
  webhookUrl?: string;
  plan: SaasPlan;
  rateLimitRps: number;
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

  const rps = Number(input.rateLimitRps);
  if (!Number.isInteger(rps) || rps < 1 || rps > 1000) {
    errors.rateLimitRps = 'El límite por segundo (rateLimitRps) debe ser un entero entre 1 y 1000.';
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
    plan: input.plan,
    rateLimitRps: Number(input.rateLimitRps),
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
