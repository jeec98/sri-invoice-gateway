import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenantAccessGuard } from './tenant-access.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApiClient, Tenant } from '@prisma/client';

describe('TenantAccessGuard — Double-Lock Multi-Tenant Authorization', () => {
  let guard: TenantAccessGuard;
  let prismaMock: {
    tenant: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  const mockClient: ApiClient = {
    id: 'client-uuid-1',
    name: 'SaaS Platform A',
    apiKeyHash: 'hash-1',
    webhookUrl: 'https://client-a.com/webhook',
    status: 'ACTIVE',
    plan: 'STANDARD',
    rateLimitRps: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockActiveTenant: Tenant = {
    id: 'tenant-uuid-10',
    apiClientId: 'client-uuid-1',
    businessName: 'ACME Corp Ecuador',
    ruc: '1790011674001',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = {
      tenant: {
        findFirst: vi.fn(),
      },
    };
    guard = new TenantAccessGuard(prismaMock as unknown as PrismaService);
  });

  const createMockContext = (
    apiClient?: ApiClient,
    params: Record<string, string> = { tenantId: 'tenant-uuid-10' },
  ) => {
    const req: any = {
      apiClient,
      params,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  };

  it('should grant access and attach req.tenant when tenant belongs to authenticated SaaS and is ACTIVE', async () => {
    prismaMock.tenant.findFirst.mockResolvedValueOnce(mockActiveTenant);
    const context = createMockContext(mockClient, { tenantId: 'tenant-uuid-10' });
    const req = context.switchToHttp().getRequest() as any;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req.tenant).toEqual(mockActiveTenant);
    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'tenant-uuid-10',
        apiClientId: 'client-uuid-1',
        status: 'ACTIVE',
      },
    });
  });

  it('should also resolve tenant if param is named :id instead of :tenantId', async () => {
    prismaMock.tenant.findFirst.mockResolvedValueOnce(mockActiveTenant);
    const context = createMockContext(mockClient, { id: 'tenant-uuid-10' });
    const req = context.switchToHttp().getRequest() as any;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req.tenant).toEqual(mockActiveTenant);
    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'tenant-uuid-10',
        apiClientId: 'client-uuid-1',
        status: 'ACTIVE',
      },
    });
  });

  it('should reject with 403 TENANT_ACCESS_DENIED when tenant belongs to another SaaS client (cross-tenant attempt)', async () => {
    // SaaS Client A is requesting tenant belonging to Client B -> query returns null
    prismaMock.tenant.findFirst.mockResolvedValueOnce(null);
    const context = createMockContext(mockClient, { tenantId: 'tenant-uuid-99' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(createMockContext(mockClient, { tenantId: 'tenant-uuid-99' })),
    ).rejects.toThrow(
      'TENANT_ACCESS_DENIED: Acceso denegado: el tenant no pertenece a la plataforma autenticada o no está activo',
    );
  });

  it('should reject with 403 TENANT_ACCESS_DENIED when tenant is INACTIVE', async () => {
    // Tenant status !== ACTIVE -> findFirst returns null
    prismaMock.tenant.findFirst.mockResolvedValueOnce(null);
    const context = createMockContext(mockClient, { tenantId: 'tenant-uuid-20' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(createMockContext(mockClient, { tenantId: 'tenant-uuid-20' })),
    ).rejects.toThrow(
      'TENANT_ACCESS_DENIED: Acceso denegado: el tenant no pertenece a la plataforma autenticada o no está activo',
    );
  });

  it('should reject with 403 TENANT_ACCESS_DENIED when tenant ID does not exist', async () => {
    prismaMock.tenant.findFirst.mockResolvedValueOnce(null);
    const context = createMockContext(mockClient, { tenantId: 'non-existent-uuid' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(createMockContext(mockClient, { tenantId: 'non-existent-uuid' })),
    ).rejects.toThrow(
      'TENANT_ACCESS_DENIED: Acceso denegado: el tenant no pertenece a la plataforma autenticada o no está activo',
    );
  });

  it('should throw 401 UnauthorizedException if req.apiClient is missing', async () => {
    const context = createMockContext(undefined, { tenantId: 'tenant-uuid-10' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 403 ForbiddenException if neither :tenantId nor :id is provided in route params', async () => {
    const context = createMockContext(mockClient, {});

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
