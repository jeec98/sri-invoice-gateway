import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { TaxpayersController } from './taxpayers.controller';
import { SRI_CATASTRO_QUEUE } from './taxpayers.constants';
import { CatastroSyncGuard } from './guards/catastro-sync.guard';
import { CkanSyncService } from './services/ckan-sync.service';
import { SriLiveLookupService } from './services/sri-live-lookup.service';
import { TaxpayersService } from './services/taxpayers.service';
import { SriCatastroProcessor } from './processors/sri-catastro.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SRI_CATASTRO_QUEUE,
    }),
    DiagnosticsModule,
  ],
  controllers: [TaxpayersController],
  providers: [
    CatastroSyncGuard,
    CkanSyncService,
    SriLiveLookupService,
    TaxpayersService,
    SriCatastroProcessor,
  ],
  exports: [TaxpayersService, CkanSyncService, SriLiveLookupService],
})
export class TaxpayersModule {}
