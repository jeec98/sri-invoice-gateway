import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { ApiClient } from '@prisma/client';

export interface ApiClientWithRawKey extends ApiClient {
  apiKey: string;
}

@Injectable()
export class ApiClientsService {
  private readonly logger = new Logger(ApiClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApiClientDto): Promise<ApiClientWithRawKey> {
    const randomHex = crypto.randomBytes(24).toString('hex');
    const apiKey = `sri_live_${randomHex}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const apiClient = await this.prisma.apiClient.create({
      data: {
        name: dto.name,
        apiKeyHash,
        webhookUrl: dto.webhookUrl ?? null,
        plan: dto.plan ?? 'STANDARD',
        rateLimitRps: dto.rateLimitRps ?? 100,
        status: 'ACTIVE',
      },
    });

    this.logger.log(`Provisioned new SaaS ApiClient: ${apiClient.name} (id: ${apiClient.id})`);

    return {
      ...apiClient,
      apiKey,
    };
  }
}
