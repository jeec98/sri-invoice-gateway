import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'MISSING_API_KEY: Se requiere autenticación mediante header Authorization: Bearer <API_KEY>.',
      );
    }

    const rawApiKey = authHeader.slice(7).trim();
    if (!rawApiKey) {
      throw new UnauthorizedException('EMPTY_API_KEY: La API Key proporcionada está vacía.');
    }

    // Compute SHA-256 hash of the bearer token
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    const tenant = await this.prisma.tenant.findUnique({
      where: { apiKeyHash },
    });

    if (!tenant || !tenant.isActive) {
      throw new UnauthorizedException(
        'INVALID_API_KEY: La API Key es inválida o el tenant se encuentra inactivo.',
      );
    }

    request.tenant = tenant;
    return true;
  }
}
