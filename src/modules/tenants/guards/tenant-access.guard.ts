import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestWithTenant } from '../../../common/types/request-with-context';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    if (!request.apiClient?.id) {
      throw new UnauthorizedException(
        'UNAUTHORIZED: Se requiere autenticación válida de la plataforma SaaS (ApiClient)',
      );
    }

    const rawTenantId = request.params?.tenantId || request.params?.id;
    const tenantId = Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId;

    if (!tenantId || typeof tenantId !== 'string') {
      throw new ForbiddenException(
        'TENANT_ACCESS_DENIED: Acceso denegado: el parámetro de tenant no fue proporcionado',
      );
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: {
        id: tenantId,
        apiClientId: request.apiClient.id,
        status: 'ACTIVE',
      },
    });

    if (!tenant) {
      throw new ForbiddenException(
        'TENANT_ACCESS_DENIED: Acceso denegado: el tenant no pertenece a la plataforma autenticada o no está activo',
      );
    }

    request.tenant = tenant;
    return true;
  }
}
