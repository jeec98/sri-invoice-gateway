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
export declare class WebhookService {
    private readonly logger;
    dispatch(webhookUrl: string, payload: WebhookNotificationPayload): Promise<{
        delivered: boolean;
        statusCode?: number;
    }>;
    private isSafeWebhookUrl;
}
