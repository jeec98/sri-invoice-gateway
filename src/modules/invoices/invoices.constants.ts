import { HttpStatus } from '@nestjs/common';

export const SRI_INVOICE_QUEUE = 'sri-invoices';
export const PROCESS_INVOICE_JOB = 'process-sri-invoice';

export const SRI_RECONCILIATION_QUEUE = 'sri-invoice-reconciliation';
export const RECONCILE_INVOICES_JOB = 'reconcile-sri-invoices';

export const DEFAULT_RECONCILIATION_THRESHOLD_SEC = 60;
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 50;

export function resolveEnqueueHttpStatus(result: { isNew: boolean; isRetry: boolean }): HttpStatus {
  return result.isNew || result.isRetry ? HttpStatus.ACCEPTED : HttpStatus.OK;
}
