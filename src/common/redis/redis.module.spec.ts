import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisModule, REDIS_CLIENT } from './redis.module';
import Redis from 'ioredis';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('RedisModule', () => {
  let module: TestingModule;
  let redisClient: Redis;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        if (key === 'REDIS_PASSWORD') return undefined;
        if (key === 'REDIS_DB') return 0;
        return defaultValue;
      }) as any,
    };

    module = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
      imports: [RedisModule],
    }).compile();

    redisClient = module.get<Redis>(REDIS_CLIENT);
  });

  it('should provide a configured REDIS_CLIENT instance', () => {
    expect(redisClient).toBeDefined();
    expect(redisClient).toBeInstanceOf(Redis);
    expect(redisClient.options.host).toBe('localhost');
    expect(redisClient.options.port).toBe(6379);
  });

  it('should cleanly quit or disconnect onModuleDestroy', async () => {
    const quitSpy = vi.spyOn(redisClient, 'quit').mockResolvedValue('OK' as any);
    const redisModuleInstance = module.get<RedisModule>(RedisModule);

    await redisModuleInstance.onModuleDestroy();
    expect(quitSpy).toHaveBeenCalled();
  });
});
