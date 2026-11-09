import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prismaMock: {
    apiClient: {
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
      apiClient: {
        findUnique: vi.fn(),
      },
    };
    guard = new ApiKeyGuard(prismaMock as never);
  });

  it('should reject requests without Authorization header with MISSING_API_KEY', async () => {
    const { context } = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'MISSING_API_KEY: Debe proporcionar una API Key en el encabezado Authorization: Bearer <key>',
      ),
    );
  });

  it('should reject requests with malformed Authorization header with MISSING_API_KEY', async () => {
    const { context } = createMockContext('Basic 123456');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'MISSING_API_KEY: Debe proporcionar una API Key en el encabezado Authorization: Bearer <key>',
      ),
    );
  });

  it('should reject requests with empty Bearer token with MISSING_API_KEY', async () => {
    const { context } = createMockContext('Bearer   ');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'MISSING_API_KEY: Debe proporcionar una API Key en el encabezado Authorization: Bearer <key>',
      ),
    );
  });

  it('should reject requests with nonexistent API Key with INVALID_API_KEY', async () => {
    prismaMock.apiClient.findUnique.mockResolvedValueOnce(null);
    const { context } = createMockContext(
      'Bearer sri_live_invalidkey0000000000000000000000000000000000000000',
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'INVALID_API_KEY: La API Key proporcionada es inválida o no existe',
      ),
    );
  });

  it('should reject requests when ApiClient status is not ACTIVE with API_CLIENT_INACTIVE', async () => {
    const rawKey = 'sri_live_abcdef1234567890abcdef1234567890abcdef1234567890';
    const mockClient = {
      id: 'client-1',
      name: 'Suspended SaaS',
      status: 'SUSPENDED',
      plan: 'STANDARD',
      rateLimitRps: 100,
    };
    prismaMock.apiClient.findUnique.mockResolvedValueOnce(mockClient);

    const { context } = createMockContext(`Bearer ${rawKey}`);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'API_CLIENT_INACTIVE: La plataforma SaaS asociada a esta API Key se encuentra inactiva o suspendida',
      ),
    );
  });

  it('should authenticate valid Bearer token, verify active ApiClient, and attach req.apiClient', async () => {
    const rawKey = 'sri_live_abcdef1234567890abcdef1234567890abcdef1234567890';
    const expectedHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const mockClient = {
      id: 'client-1',
      name: 'Active SaaS Platform',
      status: 'ACTIVE',
      plan: 'STANDARD',
      rateLimitRps: 100,
    };

    prismaMock.apiClient.findUnique.mockResolvedValueOnce(mockClient);
    const { context, request } = createMockContext(`Bearer ${rawKey}`);

    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    expect(prismaMock.apiClient.findUnique).toHaveBeenCalledWith({
      where: { apiKeyHash: expectedHash },
    });
    expect(request.apiClient).toEqual(mockClient);
  });
});
