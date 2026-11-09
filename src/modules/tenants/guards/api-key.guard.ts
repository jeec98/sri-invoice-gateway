import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestWithClient } from '../../../common/types/request-with-context';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithClient>();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'MISSING_API_KEY: Debe proporcionar una API Key en el encabezado Authorization: Bearer <key>',
      );
    }

    const rawApiKey = authHeader.slice(7).trim();
    if (!rawApiKey) {
      throw new UnauthorizedException(
        'MISSING_API_KEY: Debe proporcionar una API Key en el encabezado Authorization: Bearer <key>',
      );
    }

    // Compute SHA-256 hash of the bearer token
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    const apiClient = await this.prisma.apiClient.findUnique({
      where: { apiKeyHash },
    });

    if (!apiClient) {
      throw new UnauthorizedException(
        'INVALID_API_KEY: La API Key proporcionada es inválida o no existe',
      );
    }

    if (apiClient.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'API_CLIENT_INACTIVE: La plataforma SaaS asociada a esta API Key se encuentra inactiva o suspendida',
      );
    }

    request.apiClient = apiClient;
    return true;
  }
}
