import { describe, it, expect } from 'vitest';
import {
  buildRegistrationEndpoint,
  buildRegistrationPayload,
  isValidProviderRuc,
  validateSaasForm,
  SaasFormInput,
} from '../../docs/components/utils/saas-registration';

describe('SaasRegistrationForm utilities', () => {
  const validInput: SaasFormInput = {
    apiBaseUrl: 'https://sri-invoice-gateway-production.up.railway.app/',
    name: 'FacturaCloud SaaS',
    ruc: '1790011674001',
    webhookUrl: 'https://api.facturacloud.io/webhooks/sri',
    plan: 'PRO',
    rateLimitRps: 250,
  };

  it('should validate a complete valid SaaS registration input', () => {
    const result = validateSaasForm(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('should reject missing or malformed provider RUC', () => {
    expect(isValidProviderRuc('1790011674001')).toBe(true);
    expect(isValidProviderRuc('1790011674')).toBe(false);
    expect(isValidProviderRuc('1790011674002')).toBe(false);

    const res = validateSaasForm({ ...validInput, ruc: '12345' });
    expect(res.valid).toBe(false);
    expect(res.errors.ruc).toBeDefined();
  });

  it('should allow empty optional webhookUrl and omit it from payload', () => {
    const inputNoWebhook = { ...validInput, webhookUrl: '   ' };
    expect(validateSaasForm(inputNoWebhook).valid).toBe(true);

    const payload = buildRegistrationPayload(inputNoWebhook);
    expect(payload).toEqual({
      name: 'FacturaCloud SaaS',
      ruc: '1790011674001',
      plan: 'PRO',
      rateLimitRps: 250,
    });
    expect('webhookUrl' in payload).toBe(false);
  });

  it('should reject out-of-range rateLimitRps and invalid URLs', () => {
    const res = validateSaasForm({
      ...validInput,
      apiBaseUrl: 'ftp://invalid.com',
      webhookUrl: 'not-a-url',
      rateLimitRps: 1500,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.apiBaseUrl).toBeDefined();
    expect(res.errors.webhookUrl).toBeDefined();
    expect(res.errors.rateLimitRps).toBeDefined();
  });

  it('should build clean /v1/api-clients endpoint avoiding double slashes or /v1 duplication', () => {
    expect(
      buildRegistrationEndpoint('https://sri-invoice-gateway-production.up.railway.app/'),
    ).toBe('https://sri-invoice-gateway-production.up.railway.app/v1/api-clients');
    expect(buildRegistrationEndpoint('https://api.midominio.com/v1')).toBe(
      'https://api.midominio.com/v1/api-clients',
    );
  });
});
