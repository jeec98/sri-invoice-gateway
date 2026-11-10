import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ApiClientsService } from './api-clients.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';

describe('ApiClientsService & CreateApiClientDto', () => {
  let service: ApiClientsService;
  let prismaMock: {
    apiClient: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      apiClient: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };
    service = new ApiClientsService(prismaMock as never);
  });

  describe('CreateApiClientDto validation', () => {
    it('should validate a valid DTO with all fields', async () => {
      const dto = plainToInstance(CreateApiClientDto, {
        name: 'FacturaCloud SaaS',
        ruc: '1790011674001',
        webhookUrl: 'https://api.facturacloud.io/webhooks/sri',
        plan: 'STANDARD',
        rateLimitRps: 100,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate a valid DTO with only mandatory fields', async () => {
      const dto = plainToInstance(CreateApiClientDto, {
        name: 'QuickERP',
        ruc: '1790011674001',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when ruc is missing or invalid', async () => {
      const dtoMissing = plainToInstance(CreateApiClientDto, {
        name: 'QuickERP',
      });
      const errorsMissing = await validate(dtoMissing);
      expect(errorsMissing.length).toBeGreaterThan(0);
      expect(errorsMissing[0].property).toBe('ruc');

      const dtoInvalid = plainToInstance(CreateApiClientDto, {
        name: 'QuickERP',
        ruc: '1790011674', // not 13 digits ending in 001
      });
      const errorsInvalid = await validate(dtoInvalid);
      expect(errorsInvalid.length).toBeGreaterThan(0);
      expect(errorsInvalid[0].property).toBe('ruc');
    });

    it('should fail validation when webhookUrl has invalid format', async () => {
      const dto = plainToInstance(CreateApiClientDto, {
        name: 'FacturaCloud SaaS',
        ruc: '1790011674001',
        webhookUrl: 'not-a-valid-url',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('webhookUrl');
    });

    it('should fail validation when rateLimitRps is non-positive (<= 0)', async () => {
      const dtoZero = plainToInstance(CreateApiClientDto, {
        name: 'FacturaCloud SaaS',
        ruc: '1790011674001',
        rateLimitRps: 0,
      });
      const errorsZero = await validate(dtoZero);
      expect(errorsZero.length).toBeGreaterThan(0);
      expect(errorsZero[0].property).toBe('rateLimitRps');

      const dtoNegative = plainToInstance(CreateApiClientDto, {
        name: 'FacturaCloud SaaS',
        ruc: '1790011674001',
        rateLimitRps: -10,
      });
      const errorsNegative = await validate(dtoNegative);
      expect(errorsNegative.length).toBeGreaterThan(0);
      expect(errorsNegative[0].property).toBe('rateLimitRps');
    });

    it('should fail validation when name is empty', async () => {
      const dto = plainToInstance(CreateApiClientDto, {
        name: '',
        ruc: '1790011674001',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });
  });

  describe('ApiClientsService.create', () => {
    it('should generate an API key matching ^sri_live_[0-9a-f]{48}$, store SHA-256 hash and ruc, and return raw apiKey', async () => {
      const dto: CreateApiClientDto = {
        name: 'FacturaCloud SaaS',
        ruc: '1790011674001',
        webhookUrl: 'https://api.facturacloud.io/webhooks/sri',
        plan: 'STANDARD',
        rateLimitRps: 100,
      };

      const mockCreatedRecord = {
        id: 'client-uuid-1',
        name: dto.name,
        ruc: dto.ruc,
        apiKeyHash: 'mock-hash',
        webhookUrl: dto.webhookUrl,
        plan: 'STANDARD',
        rateLimitRps: 100,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.apiClient.create.mockResolvedValueOnce(mockCreatedRecord);

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(result.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
      expect(result.id).toBe('client-uuid-1');
      expect(result.name).toBe('FacturaCloud SaaS');
      expect(result.ruc).toBe('1790011674001');
      expect(result.status).toBe('ACTIVE');

      expect(prismaMock.apiClient.create).toHaveBeenCalledTimes(1);
      const createArgs = prismaMock.apiClient.create.mock.calls[0][0];

      // Verify SHA-256 hash of generated key matches what was passed to Prisma
      const expectedHash = crypto.createHash('sha256').update(result.apiKey).digest('hex');
      expect(createArgs.data.apiKeyHash).toBe(expectedHash);
      expect(createArgs.data.apiKeyHash).not.toBe(result.apiKey); // Raw key never in apiKeyHash
      expect(createArgs.data.status).toBe('ACTIVE');
      expect(createArgs.data.name).toBe('FacturaCloud SaaS');
      expect(createArgs.data.ruc).toBe('1790011674001');
      expect(createArgs.data.webhookUrl).toBe('https://api.facturacloud.io/webhooks/sri');
      expect(createArgs.data.plan).toBe('STANDARD');
      expect(createArgs.data.rateLimitRps).toBe(100);
    });

    it('should use default values for plan (STANDARD) and rateLimitRps (100) when omitted', async () => {
      const dto: CreateApiClientDto = {
        name: 'QuickERP',
        ruc: '1790011674001',
      };

      const mockCreatedRecord = {
        id: 'client-uuid-2',
        name: 'QuickERP',
        ruc: '1790011674001',
        apiKeyHash: 'mock-hash-2',
        webhookUrl: null,
        plan: 'STANDARD',
        rateLimitRps: 100,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.apiClient.create.mockResolvedValueOnce(mockCreatedRecord);

      const result = await service.create(dto);

      expect(result.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
      const createArgs = prismaMock.apiClient.create.mock.calls[0][0];
      expect(createArgs.data.ruc).toBe('1790011674001');
      expect(createArgs.data.plan).toBe('STANDARD');
      expect(createArgs.data.rateLimitRps).toBe(100);
      expect(createArgs.data.status).toBe('ACTIVE');
    });

    it('should throw ConflictException (API_CLIENT_RUC_EXISTS) if a SaaS with the same RUC already exists', async () => {
      prismaMock.apiClient.findUnique.mockResolvedValueOnce({
        id: 'existing-client-id',
        ruc: '1790011674001',
      });

      const dto: CreateApiClientDto = {
        name: 'Duplicate SaaS',
        ruc: '1790011674001',
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(prismaMock.apiClient.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (API_CLIENT_RUC_EXISTS) on Prisma P2002 race condition', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      });
      prismaMock.apiClient.create.mockRejectedValueOnce(p2002Error);

      const dto: CreateApiClientDto = {
        name: 'Race Condition SaaS',
        ruc: '1790011674001',
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });
});
