import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ApiClient, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';

export interface ApiClientWithRawKey extends ApiClient {
  apiKey: string;
}

@Injectable()
export class ApiClientsService {
  private readonly logger = new Logger(ApiClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApiClientDto): Promise<ApiClientWithRawKey> {
    const existing = await this.prisma.apiClient.findUnique({
      where: { ruc: dto.ruc },
    });

    if (existing) {
      throw new ConflictException(
        `API_CLIENT_RUC_EXISTS: Ya existe una plataforma SaaS registrada con el RUC (${dto.ruc}).`,
      );
    }

    const randomHex = crypto.randomBytes(24).toString('hex');
    const apiKey = `sri_live_${randomHex}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const apiClient = await this.prisma.apiClient.create({
        data: {
          name: dto.name,
          ruc: dto.ruc,
          apiKeyHash,
          webhookUrl: dto.webhookUrl ?? null,
          plan: 'DEFAULT',
          rateLimitRps: dto.rateLimitRps ?? 20,
          status: 'ACTIVE',
        },
      });

      this.logger.log(`Provisioned new SaaS ApiClient: ${apiClient.name} (id: ${apiClient.id})`);

      return {
        ...apiClient,
        apiKey,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `API_CLIENT_RUC_EXISTS: Ya existe una plataforma SaaS registrada con el RUC (${dto.ruc}).`,
        );
      }
      throw error;
    }
  }
}
