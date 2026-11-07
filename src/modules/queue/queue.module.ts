import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CryptoModule } from '../crypto/crypto.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SRI_INVOICE_QUEUE } from '../invoices/invoices.constants';
import { SriSoapModule } from '../sri-soap/sri-soap.module';
import { WebhookModule } from '../webhook/webhook.module';
import { InvoiceQueueConsumer } from './invoice-queue.consumer';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SRI_INVOICE_QUEUE,
    }),
    CryptoModule,
    InvoicesModule,
    SriSoapModule,
    WebhookModule,
  ],
  providers: [InvoiceQueueConsumer],
  exports: [InvoiceQueueConsumer],
})
export class QueueModule {}
