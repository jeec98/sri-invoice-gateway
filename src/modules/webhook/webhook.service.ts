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
    const bodyString = JSON.stringify(payload);
    const secret =
      process.env.WEBHOOK_SIGNING_SECRET || 'whsec_sri_gateway_default_secret_key';
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
}

