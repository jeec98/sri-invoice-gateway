import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prismaMock: {
    tenant: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  function createMockContext(authHeader?: string): {
    context: ExecutionContext;
    request: Record<string, unknown>;
  } {
    const request: Record<string, unknown> = {
      headers: authHeader !== undefined ? { authorization: authHeader } : {},
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: vi.fn(),
      },
    };
    guard = new ApiKeyGuard(prismaMock as never);
  });

  it('should reject requests without Authorization Bearer header', async () => {
    const { context } = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject requests with unknown or inactive tenant API key', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
    const { context } = createMockContext('Bearer sri_live_invalid_key');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should authenticate active tenant by SHA-256 hash and attach tenant to request', async () => {
    const rawKey = 'sri_live_valid_secret_key';
    const expectedHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const mockTenant = { id: 'tenant-1', ruc: '1790011674001', isActive: true };

    prismaMock.tenant.findUnique.mockResolvedValueOnce(mockTenant);
    const { context, request } = createMockContext(`Bearer ${rawKey}`);

    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: { apiKeyHash: expectedHash },
    });
    expect(request.tenant).toEqual(mockTenant);
  });
});
