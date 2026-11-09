import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let redisMock: {
    pipeline: ReturnType<typeof vi.fn>;
  };
  let pipelineMock: {
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };

  function createMockContext(apiClient?: { id: string; rateLimitRps: number }): {
    context: ExecutionContext;
    request: Record<string, unknown>;
    response: {
      headers: Record<string, string>;
      setHeader: ReturnType<typeof vi.fn>;
    };
  } {
    const headers: Record<string, string> = {};
    const response = {
      headers,
      setHeader: vi.fn((key: string, value: string) => {
        headers[key.toLowerCase()] = value;
      }),
    };
    const request: Record<string, unknown> = {
      apiClient,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, request, response };
  }

  beforeEach(() => {
    pipelineMock = {
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    };

    redisMock = {
      pipeline: vi.fn(() => pipelineMock),
    };

    guard = new RateLimitGuard(redisMock as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within configured threshold and set rate limit headers', async () => {
    const client = { id: 'client-uuid-1', rateLimitRps: 100 };
    const { context, response } = createMockContext(client);

    // Mock Redis returning count 51 for 51st request
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 51],
      [null, 1],
    ]);

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(redisMock.pipeline).toHaveBeenCalled();
    expect(pipelineMock.incr).toHaveBeenCalledWith(
      expect.stringMatching(/^ratelimit:client-uuid-1:\d+$/),
    );
    expect(pipelineMock.expire).toHaveBeenCalledWith(
      expect.stringMatching(/^ratelimit:client-uuid-1:\d+$/),
      2,
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '49');
  });

  it('should throw 429 Too Many Requests with Retry-After when rate limit is exceeded', async () => {
    const client = { id: 'client-uuid-1', rateLimitRps: 100 };
    const { context, response } = createMockContext(client);

    // Mock Redis returning count 101 on a 100 rps client
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 101],
      [null, 1],
    ]);

    let caughtError: unknown;
    try {
      await guard.canActivate(context);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(HttpException);
    const httpError = caughtError as HttpException;
    expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(httpError.message).toContain('RATE_LIMIT_EXCEEDED');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('should isolate rate limit quotas independently per client (noisy-neighbor isolation)', async () => {
    const clientA = { id: 'client-a', rateLimitRps: 50 };
    const clientB = { id: 'client-b', rateLimitRps: 50 };

    const ctxA = createMockContext(clientA);
    const ctxB = createMockContext(clientB);

    // Client A exceeds limit (count 51)
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 51],
      [null, 1],
    ]);
    await expect(guard.canActivate(ctxA.context)).rejects.toThrow(HttpException);

    // Client B sends request and is within limit (count 1)
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    const allowedB = await guard.canActivate(ctxB.context);

    expect(allowedB).toBe(true);
    expect(pipelineMock.incr).toHaveBeenCalledWith(
      expect.stringMatching(/^ratelimit:client-b:\d+$/),
    );
    expect(ctxB.response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '49');
  });

  it('should reset quota in the next 1-second window', async () => {
    vi.useFakeTimers();
    const client = { id: 'client-reset', rateLimitRps: 10 };

    // At second 1000
    vi.setSystemTime(new Date(1000000));
    const ctx1 = createMockContext(client);
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 11], // Exceeded
      [null, 1],
    ]);
    await expect(guard.canActivate(ctx1.context)).rejects.toThrow(HttpException);
    expect(pipelineMock.incr).toHaveBeenCalledWith('ratelimit:client-reset:1000');

    // 1 second later (second 1001)
    vi.setSystemTime(new Date(1001000));
    const ctx2 = createMockContext(client);
    pipelineMock.exec.mockResolvedValueOnce([
      [null, 1], // Fresh window
      [null, 1],
    ]);
    const allowed = await guard.canActivate(ctx2.context);

    expect(allowed).toBe(true);
    expect(pipelineMock.incr).toHaveBeenCalledWith('ratelimit:client-reset:1001');
    expect(ctx2.response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '9');
  });

  it('should fail-open with a warning when Redis throws an unexpected error', async () => {
    const client = { id: 'client-uuid-failopen', rateLimitRps: 100 };
    const { context } = createMockContext(client);

    pipelineMock.exec.mockRejectedValueOnce(new Error('Redis connection timed out'));

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
  });
});
