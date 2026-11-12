import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { ApiClientsModule } from './modules/api-clients/api-clients.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SriSoapModule } from './modules/sri-soap/sri-soap.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { QueueModule } from './modules/queue/queue.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          const parsed = new URL(redisUrl);
          return {
            connection: {
              host: parsed.hostname,
              port: Number(parsed.port) || 6379,
              username: parsed.username || undefined,
              password: parsed.password || undefined,
              db:
                parsed.pathname && parsed.pathname !== '/'
                  ? Number(parsed.pathname.replace('/', '')) || 0
                  : 0,
              tls: parsed.protocol === 'rediss:' ? {} : undefined,
            },
          };
        }
        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
            db: Number(configService.get<number>('REDIS_DB', 0)),
          },
        };
      },
    }),
    PrismaModule,
    CryptoModule,
    ApiClientsModule,
    TenantsModule,
    InvoicesModule,
    SriSoapModule,
    WebhookModule,
    QueueModule,
    DiagnosticsModule,
  ],
})
export class AppModule {}
