import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SriSoapModule } from './modules/sri-soap/sri-soap.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    PrismaModule,
    CryptoModule,
    TenantsModule,
    InvoicesModule,
    SriSoapModule,
    WebhookModule,
    QueueModule,
  ],
})
export class AppModule {}

