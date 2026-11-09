import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { TenantAccessGuard } from './guards/tenant-access.guard';

@Module({
  imports: [CryptoModule],
  controllers: [TenantsController],
  providers: [TenantsService, ApiKeyGuard, TenantAccessGuard],
  exports: [TenantsService, ApiKeyGuard, TenantAccessGuard],
})
export class TenantsModule {}
