import { Module, Global, OnModuleDestroy, Inject, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RateLimitGuard } from '../guards/rate-limit.guard';

export * from './redis.constants';

const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService): Redis => {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(configService.get<number>('REDIS_PORT', 6379));
    const password = configService.get<string>('REDIS_PASSWORD') || undefined;
    const db = Number(configService.get<number>('REDIS_DB', 0));

    return new Redis({
      host,
      port,
      password,
      db,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  },
  inject: [ConfigService],
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisClientProvider, RateLimitGuard],
  exports: [REDIS_CLIENT, RateLimitGuard],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.redisClient.status !== 'end') {
        await this.redisClient.quit();
      }
    } catch {
      this.redisClient.disconnect();
    }
  }
}
