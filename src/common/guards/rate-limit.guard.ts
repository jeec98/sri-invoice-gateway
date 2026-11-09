import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RequestWithClient } from '../types/request-with-context';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithClient>();
    const res = http.getResponse();

    const client = req.apiClient;
    if (!client) {
      return true;
    }

    const rateLimitRps = client.rateLimitRps || 100;
    const windowSec = Math.floor(Date.now() / 1000);
    const windowKey = `ratelimit:${client.id}:${windowSec}`;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(windowKey);
      pipeline.expire(windowKey, 2);

      const results = await pipeline.exec();
      if (!results || results.length === 0) {
        return true;
      }

      const [incrErr, countVal] = results[0];
      if (incrErr) {
        throw incrErr;
      }

      const count = Number(countVal);

      if (count > rateLimitRps) {
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', '1');
          res.setHeader('X-RateLimit-Limit', rateLimitRps.toString());
          res.setHeader('X-RateLimit-Remaining', '0');
        }

        throw new HttpException(
          `RATE_LIMIT_EXCEEDED: Se ha superado el límite de peticiones por segundo permitido para su plataforma (${rateLimitRps} req/s)`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const remaining = Math.max(0, rateLimitRps - count);
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('X-RateLimit-Limit', rateLimitRps.toString());
        res.setHeader('X-RateLimit-Remaining', remaining.toString());
      }

      return true;
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.warn(
        `Redis rate-limiting failed, failing open for client ${client.id}: ${(err as Error)?.message}`,
      );
      return true;
    }
  }
}
