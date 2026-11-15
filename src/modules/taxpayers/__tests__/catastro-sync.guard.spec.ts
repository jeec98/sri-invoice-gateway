import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatastroSyncGuard } from '../guards/catastro-sync.guard';

function makeContext(headers: Record<string, string>, plan = 'DEFAULT') {
  const req: Record<string, unknown> = {
    headers,
    apiClient: { id: 'client-1', plan, status: 'ACTIVE' },
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('CatastroSyncGuard (TDD)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SRI_INTERNAL_ADMIN_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects with 403 ForbiddenException when SRI_INTERNAL_ADMIN_KEY is configured and X-Internal-Key is missing or invalid', () => {
    process.env.SRI_INTERNAL_ADMIN_KEY = 'super-secret-internal-key-2026';
    const guard = new CatastroSyncGuard();

    const { ctx: missingHeaderCtx } = makeContext({});
    expect(() => guard.canActivate(missingHeaderCtx)).toThrow(ForbiddenException);

    const { ctx: wrongHeaderCtx } = makeContext({ 'x-internal-key': 'wrong-key' });
    expect(() => guard.canActivate(wrongHeaderCtx)).toThrow(ForbiddenException);
  });

  it('allows request and marks isInternalAdmin=true when X-Internal-Key matches SRI_INTERNAL_ADMIN_KEY', () => {
    process.env.SRI_INTERNAL_ADMIN_KEY = 'super-secret-internal-key-2026';
    const guard = new CatastroSyncGuard();

    const { ctx, req } = makeContext({ 'x-internal-key': 'super-secret-internal-key-2026' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.isInternalAdmin).toBe(true);
  });

  it('allows ApiClient with plan=INTERNAL or ADMIN and rejects regular DEFAULT client in production', () => {
    process.env.NODE_ENV = 'production';
    const guard = new CatastroSyncGuard();

    const { ctx: regularCtx } = makeContext({}, 'STANDARD');
    expect(() => guard.canActivate(regularCtx)).toThrow(ForbiddenException);

    const { ctx: internalCtx, req } = makeContext({}, 'INTERNAL');
    expect(guard.canActivate(internalCtx)).toBe(true);
    expect(req.isInternalAdmin).toBe(true);
  });
});
