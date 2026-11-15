import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { RequestWithClient } from '../../../common/types/request-with-context';

const INTERNAL_PLANS = new Set(['INTERNAL', 'ADMIN']);

function safeSecretMatch(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Restricts administrative/operational endpoints (e.g. POST /v1/taxpayers/sync)
 * to internal/admin callers via SRI_INTERNAL_ADMIN_KEY (X-Internal-Key / X-Admin-Key)
 * or an ApiClient provisioned with plan = INTERNAL | ADMIN.
 *
 * In production, regular SaaS ApiClients are always rejected with 403 Forbidden.
 * In non-production when SRI_INTERNAL_ADMIN_KEY is unset, regular ApiClients fall
 * through with isInternalAdmin=false so server-side Redis cooldown still applies.
 */
@Injectable()
export class CatastroSyncGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithClient>();
    const configuredAdminKey = process.env.SRI_INTERNAL_ADMIN_KEY?.trim() || '';
    const headerRaw = request.headers['x-internal-key'] ?? request.headers['x-admin-key'];
    const providedKey = Array.isArray(headerRaw) ? headerRaw[0]?.trim() : headerRaw?.trim();

    const matchesAdminKey = Boolean(
      configuredAdminKey && providedKey && safeSecretMatch(providedKey, configuredAdminKey),
    );
    const hasInternalPlan = Boolean(
      request.apiClient?.plan && INTERNAL_PLANS.has(request.apiClient.plan.toUpperCase()),
    );

    const isInternalAdmin = matchesAdminKey || hasInternalPlan;
    request.isInternalAdmin = isInternalAdmin;

    const requireInternal = Boolean(configuredAdminKey) || process.env.NODE_ENV === 'production';
    if (requireInternal && !isInternalAdmin) {
      throw new ForbiddenException(
        'SYNC_FORBIDDEN: Solo credenciales internas/administrativas (X-Internal-Key o plan INTERNAL/ADMIN) pueden iniciar la sincronización de catastro.',
      );
    }

    return true;
  }
}
