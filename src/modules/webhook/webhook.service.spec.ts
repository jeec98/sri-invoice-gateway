import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import * as crypto from 'node:crypto';
import { WebhookService, WebhookNotificationPayload } from './webhook.service';

vi.mock('axios');

describe('WebhookService', () => {
  let service: WebhookService;
  const originalEnv = process.env;

  const samplePayload: WebhookNotificationPayload = {
    event: 'sri.invoice.completed',
    jobId: 'job-123',
    referenceId: 'INV-001',
    claveAcceso: '0711202601179001167400110010010000001231234567815',
    ambiente: '1',
    status: 'AUTORIZADO',
    numeroAutorizacion: '0711202601179001167400110010010000001231234567815',
    fechaAutorizacion: '2026-11-07T12:00:00-05:00',
    authorizedXml: '<autorizacion/>',
    sriMessages: [],
    timestamp: '2026-11-07T17:00:00.000Z',
  };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    service = new WebhookService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should dispatch webhook with valid HMAC-SHA256 signature and maxRedirects=0', async () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'test_webhook_secret';
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200 });

    const result = await service.dispatch('https://saas.example.com/webhooks/sri', samplePayload);

    expect(result).toEqual({ delivered: true, statusCode: 200 });
    const expectedHmac = crypto
      .createHmac('sha256', 'test_webhook_secret')
      .update(JSON.stringify(samplePayload))
      .digest('hex');

    expect(axios.post).toHaveBeenCalledWith(
      'https://saas.example.com/webhooks/sri',
      samplePayload,
      expect.objectContaining({
        maxRedirects: 0,
        headers: expect.objectContaining({
          'X-SRI-Gateway-Event': 'sri.invoice.completed',
          'X-SRI-Gateway-Signature': `sha256=${expectedHmac}`,
        }),
      }),
    );
  });

  it('should block cloud metadata SSRF targets in any environment', async () => {
    const result = await service.dispatch(
      'http://169.254.169.254/latest/meta-data/',
      samplePayload,
    );

    expect(result).toEqual({ delivered: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should block private RFC1918 and loopback targets in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SIGNING_SECRET = 'prod_secret_key';

    const result = await service.dispatch('http://127.0.0.1:6379/internal', samplePayload);

    expect(result).toEqual({ delivered: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should fail safely in production if WEBHOOK_SIGNING_SECRET is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOK_SIGNING_SECRET;

    const result = await service.dispatch('https://saas.example.com/webhooks/sri', samplePayload);

    expect(result).toEqual({ delivered: false });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

