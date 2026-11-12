import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { SriSoapModule } from '../sri-soap/sri-soap.module';
import { TenantsModule } from '../tenants/tenants.module';
import { RucValidatorService } from './services/ruc-validator.service';
import { DiagnosticsService } from './diagnostics.service';
import { DiagnosticsController } from './diagnostics.controller';

@Module({
  imports: [CryptoModule, SriSoapModule, TenantsModule],
  controllers: [DiagnosticsController],
  providers: [RucValidatorService, DiagnosticsService],
  exports: [RucValidatorService, DiagnosticsService],
})
export class DiagnosticsModule {}

