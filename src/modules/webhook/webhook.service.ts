import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'node:crypto';
import { SriMessage } from '../sri-soap/sri-soap-client.service';

export interface WebhookNotificationPayload {
  event: 'sri.invoice.completed';
  jobId: string;
  referenceId: string;
  claveAcceso: string;
  ambiente: string;
  status: 'AUTORIZADO' | 'NO_AUTORIZADO' | 'DEVUELTA' | 'EN_PROCESO' | 'FAILED';
  numeroAutorizacion?: string | null;
  fechaAutorizacion?: string | null;
  authorizedXml?: string | null;
  sriMessages: SriMessage[];
  timestamp: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  async dispatch(
    webhookUrl: string,
    payload: WebhookNotificationPayload,
  ): Promise<{ delivered: boolean; statusCode?: number }> {
    const envSecret = process.env.WEBHOOK_SIGNING_SECRET;
    if (!envSecret && process.env.NODE_ENV === 'production') {
      this.logger.error(
        'MISSING_WEBHOOK_SECRET: WEBHOOK_SIGNING_SECRET is required in production.',
      );
      return { delivered: false };
    }

    if (!this.isSafeWebhookUrl(webhookUrl)) {
      this.logger.error(
        `BLOCKED_WEBHOOK_URL: Unsafe or disallowed webhook target "${webhookUrl}" for claveAcceso=${payload.claveAcceso}`,
      );
      return { delivered: false };
    }

    const bodyString = JSON.stringify(payload);
    const secret = envSecret || 'whsec_sri_gateway_default_secret_key';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(bodyString)
      .digest('hex');

    const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);

    try {
      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-SRI-Gateway-Event': payload.event,
          'X-SRI-Gateway-Signature': `sha256=${signature}`,
        },
        timeout: timeoutMs,
        maxRedirects: 0,
      });

      this.logger.log(
        `Webhook delivered to ${webhookUrl} for claveAcceso=${payload.claveAcceso} [HTTP ${response.status}]`,
      );

      return {
        delivered: response.status >= 200 && response.status < 300,
        statusCode: response.status,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Webhook delivery failed to ${webhookUrl} for claveAcceso=${payload.claveAcceso}: ${errMsg}`,
      );
      return {
        delivered: false,
      };
    }
  }

  private isSafeWebhookUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();
      // Always block cloud metadata endpoints
      if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
        return false;
      }

      if (process.env.NODE_ENV === 'production') {
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '[::1]' ||
          hostname.startsWith('10.') ||
          hostname.startsWith('192.168.') ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
        ) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}

