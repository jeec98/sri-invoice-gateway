import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenantsModule } from '../tenants/tenants.module';
import { AccessKeyService } from './services/access-key.service';
import { XmlBuilderService } from './services/xml-builder.service';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { RetentionsController } from './retentions.controller';
import { SRI_INVOICE_QUEUE } from './invoices.constants';

@Module({
  imports: [
    TenantsModule,
    BullModule.registerQueue({
      name: SRI_INVOICE_QUEUE,
    }),
  ],
  controllers: [InvoicesController, RetentionsController],
  providers: [AccessKeyService, XmlBuilderService, InvoicesService],
  exports: [AccessKeyService, XmlBuilderService, InvoicesService],
})
export class InvoicesModule {}
