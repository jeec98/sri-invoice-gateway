import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import type Redis from 'ioredis';
import type { PrismaService as PrismaServiceType } from '../src/prisma/prisma.service';
import type { SriLiveLookupService as SriLiveLookupServiceType } from '../src/modules/taxpayers/services/sri-live-lookup.service';
import type { CkanSyncService as CkanSyncServiceType } from '../src/modules/taxpayers/services/ckan-sync.service';

const requireCjs = createRequire(__filename);
const axiosCjs = requireCjs('axios');
const { NestFactory } = requireCjs('@nestjs/core');
const { AppModule } = requireCjs('../dist/app.module.js');
const { PrismaService } = requireCjs('../dist/prisma/prisma.service.js');
const { REDIS_CLIENT } = requireCjs('../dist/common/redis/redis.constants.js');
const { SriLiveLookupService } = requireCjs(
  '../dist/modules/taxpayers/services/sri-live-lookup.service.js',
);
const { CkanSyncService } = requireCjs('../dist/modules/taxpayers/services/ckan-sync.service.js');

describe('Taxpayers & SRI Catastro — E2E Suite', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prisma: PrismaServiceType;
  let redis: Redis;
  let sriLiveLookup: SriLiveLookupServiceType;
  let ckanSync: CkanSyncServiceType;

  const clientARuc = '1794444443001';
  const clientBRuc = '1795555559001';
  const throttledClientRuc = '1796666664001';

  const buyerAgentRuc = '1790016919001';
  const sellerGeneralRuc = '1790011674001';
  const sellerRimpePopRuc = '1710034065001';
  const invalidMod11Ruc = '1790016918001';

  let apiKeyClientA = '';
  let apiKeyClientB = '';
  let throttledApiKey = '';

  const testClientNames = [
    'E2E Catastro SaaS Alpha',
    'E2E Catastro SaaS Beta',
    'E2E Catastro SaaS Throttled',
  ];

  async function cleanupTestData() {
    if (prisma) {
      await prisma.apiClient.deleteMany({
        where: {
          OR: [
            { name: { in: testClientNames } },
            { ruc: { in: [clientARuc, clientBRuc, throttledClientRuc] } },
          ],
        },
      });

      await prisma.sriTaxpayerProfile.deleteMany({
        where: { ruc: { in: [buyerAgentRuc, sellerGeneralRuc, sellerRimpePopRuc] } },
      });

      await prisma.sriTaxpayerSpecial.deleteMany({
        where: { ruc: { in: [buyerAgentRuc, sellerGeneralRuc, sellerRimpePopRuc] } },
      });

      await prisma.sriCatalogSyncState.deleteMany({
        where: { source: { in: ['AGENTS', 'SPECIAL', 'RIMPE'] } },
      });
    }

    if (redis) {
      await redis.del(
        `sri:taxpayer:${buyerAgentRuc}`,
        `sri:taxpayer:${sellerGeneralRuc}`,
        `sri:taxpayer:${sellerRimpePopRuc}`,
        'sri:live:circuit_open',
        'sri:catastro:sync:cooldown:ALL',
        'sri:catastro:sync:cooldown:AGENTS',
        'sri:catastro:sync:cooldown:SPECIAL',
        'sri:catastro:sync:cooldown:RIMPE',
      );
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_DB = '1';

    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.listen(0, '127.0.0.1');
    const serverAddr = app.getHttpServer().address();
    const appPort = typeof serverAddr === 'object' && serverAddr ? serverAddr.port : 3000;
    baseUrl = `http://127.0.0.1:${appPort}/v1`;

    prisma = app.get(PrismaService);
    redis = app.get(REDIS_CLIENT);
    sriLiveLookup = app.get(SriLiveLookupService);
    ckanSync = app.get(CkanSyncService);

    await cleanupTestData();

    // Prevent E2E queue workers from hitting live CKAN or live SRI endpoints
    vi.spyOn(ckanSync, 'syncAll').mockResolvedValue([]);
    vi.spyOn(ckanSync, 'syncSource').mockResolvedValue({
      source: 'AGENTS',
      skipped: true,
      rowCount: 0,
      status: 'SKIPPED',
    });
    vi.spyOn(sriLiveLookup, 'lookupByRuc').mockImplementation(async (ruc: string) => {
      if (ruc === sellerGeneralRuc || ruc === buyerAgentRuc) {
        return {
          circuitOpen: false,
          data: {
            ruc,
            razonSocial:
              ruc === buyerAgentRuc ? 'CORPORACION FAVORITA C.A.' : 'PROVEEDOR GENERAL E2E S.A.',
            nombreComercial: null,
            tipoContribuyente: 'SOCIEDAD',
            estadoContribuyente: 'ACTIVO',
            obligadoContabilidad: true,
            actividadEconomica: 'COMERCIO AL POR MENOR',
            direccionMatriz: 'QUITO',
            regimenTributario: 'GENERAL',
          },
        };
      }
      return { data: null, circuitOpen: false };
    });

    // Provision SaaS Client A, SaaS Client B, and throttled SaaS Client
    const createClient = async (name: string, ruc: string, rateLimitRps: number) => {
      const res = await fetch(`${baseUrl}/api-clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ruc, rateLimitRps }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as { apiKey: string };
    };

    const [clientA, clientB, throttled] = await Promise.all([
      createClient('E2E Catastro SaaS Alpha', clientARuc, 100),
      createClient('E2E Catastro SaaS Beta', clientBRuc, 100),
      createClient('E2E Catastro SaaS Throttled', throttledClientRuc, 2),
    ]);

    apiKeyClientA = clientA.apiKey;
    apiKeyClientB = clientB.apiKey;
    throttledApiKey = throttled.apiKey;

    // Seed public SriTaxpayerSpecial catalog (completely decoupled from Tenant/ApiClient)
    await prisma.sriTaxpayerSpecial.createMany({
      data: [
        {
          ruc: buyerAgentRuc,
          razonSocial: 'CORPORACION FAVORITA C.A.',
          isWithholdingAgent: true,
          withholdingAgentRes: 'NAC-DNCRASC20-00000001',
          inAgentsCatalog: true,
          isSpecialTaxpayer: true,
          specialTaxpayerRes: '5368',
          inSpecialCatalog: true,
          inRimpeCatalog: false,
          regimen: 'GENERAL',
        },
        {
          ruc: sellerRimpePopRuc,
          razonSocial: 'TIENDA BARRIO POPULAR',
          isWithholdingAgent: false,
          isSpecialTaxpayer: false,
          inRimpeCatalog: true,
          regimen: 'RIMPE_NEGOCIO_POPULAR',
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    if (app) {
      await app.close();
    }
  });

  it('enforces ApiKeyGuard (401) across GET :ruc, POST withholding-eligibility, and POST sync', async () => {
    const [r1, r2, r3, r4] = await Promise.all([
      fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`),
      fetch(`${baseUrl}/taxpayers/withholding-eligibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerRuc: buyerAgentRuc, sellerRuc: sellerGeneralRuc }),
      }),
      fetch(`${baseUrl}/taxpayers/sync`, { method: 'POST' }),
      fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
        headers: { Authorization: 'Bearer sri_live_invalid_api_key_0000' },
      }),
    ]);

    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(401);
    expect(r4.status).toBe(401);
  });

  it('returns 400 on invalid Modulo-11 RUC and on malformed DTO payloads', async () => {
    const invalidRucRes = await fetch(`${baseUrl}/taxpayers/${invalidMod11Ruc}`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    expect(invalidRucRes.status).toBe(400);
    const invalidBody = (await invalidRucRes.json()) as { message: string };
    expect(invalidBody.message).toContain('INVALID_RUC');

    const extraFieldRes = await fetch(`${baseUrl}/taxpayers/withholding-eligibility`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        buyerRuc: buyerAgentRuc,
        sellerRuc: sellerGeneralRuc,
        unauthorizedExtraField: true,
      }),
    });
    expect(extraFieldRes.status).toBe(400);
  });

  it('serves identical public catalog data to SaaS A and SaaS B with zero tenant leakage (200)', async () => {
    const resA = await fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    const resB = await fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
      headers: { Authorization: `Bearer ${apiKeyClientB}` },
    });

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const profileA = (await resA.json()) as Record<string, unknown>;
    const profileB = (await resB.json()) as Record<string, unknown>;

    expect(profileA.ruc).toBe(buyerAgentRuc);
    expect(profileA.razonSocial).toBe('CORPORACION FAVORITA C.A.');
    expect(profileA.esAgenteRetencion).toBe(true);
    expect(profileA.esContribuyenteEspecial).toBe(true);

    expect(profileB.ruc).toBe(profileA.ruc);
    expect(profileB.razonSocial).toBe(profileA.razonSocial);
    expect(profileB.esAgenteRetencion).toBe(profileA.esAgenteRetencion);
    expect(profileB.esContribuyenteEspecial).toBe(profileA.esContribuyenteEspecial);

    // Public catalog response must never contain tenant or certificate identifiers
    for (const forbidden of ['tenantId', 'apiClientId', 'certificateId', 'apiKeyHash']) {
      expect(profileA).not.toHaveProperty(forbidden);
      expect(profileB).not.toHaveProperty(forbidden);
    }
  });

  it('evaluates withholding eligibility via POST /v1/taxpayers/withholding-eligibility (200)', async () => {
    const res = await fetch(`${baseUrl}/taxpayers/withholding-eligibility`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        buyerRuc: buyerAgentRuc,
        sellerRuc: sellerRimpePopRuc,
        codDocSustento: '02',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      whoWithholds: string;
      reasonCode: string;
      zeroInformativePolicy: boolean;
      reglasAplicables: string[];
      sellerIsRimpePopular: boolean;
    };

    expect(body.whoWithholds).toBe('NEITHER');
    expect(body.reasonCode).toBe('RIMPE_NEGOCIO_POPULAR_332');
    expect(body.zeroInformativePolicy).toBe(true);
    expect(body.sellerIsRimpePopular).toBe(true);
    expect(body.reglasAplicables).toContain('RIMPE_NEGOCIO_POPULAR_COD_332_0PCT');
  });

  it('queues catalog sync on POST /v1/taxpayers/sync with explicit or empty body (202)', async () => {
    const explicitRes = await fetch(`${baseUrl}/taxpayers/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'AGENTS', force: false }),
    });
    expect(explicitRes.status).toBe(202);
    const explicitBody = (await explicitRes.json()) as {
      success: boolean;
      queued: boolean;
      jobId: string;
      source: string;
    };
    expect(explicitBody.success).toBe(true);
    expect(explicitBody.queued).toBe(true);
    expect(explicitBody.source).toBe('AGENTS');
    expect(explicitBody.jobId.length).toBeGreaterThan(0);

    // Empty body should safely default to source: 'ALL'
    const emptyBodyRes = await fetch(`${baseUrl}/taxpayers/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
      },
    });
    expect(emptyBodyRes.status).toBe(202);
    const emptyBodyJson = (await emptyBodyRes.json()) as {
      success: boolean;
      queued: boolean;
      source: string;
    };
    expect(emptyBodyJson.success).toBe(true);
    expect(emptyBodyJson.queued).toBe(true);
    expect(emptyBodyJson.source).toBe('ALL');

    // Non-internal caller hitting cooldown even with force: true receives 429
    const cooldownRes = await fetch(`${baseUrl}/taxpayers/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'SPECIAL', force: false }),
    });
    expect(cooldownRes.status).toBe(202);

    // Wait briefly so worker finishes SPECIAL job, then verify cooldown blocks immediate retry
    await new Promise((r) => setTimeout(r, 100));
    const throttledSyncRes = await fetch(`${baseUrl}/taxpayers/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'SPECIAL', force: true }),
    });
    expect([202, 429]).toContain(throttledSyncRes.status);
    if (throttledSyncRes.status === 429) {
      const errBody = (await throttledSyncRes.json()) as { message: string };
      expect(errBody.message).toContain('SYNC_COOLDOWN_ACTIVE');
    } else {
      const dedupBody = (await throttledSyncRes.json()) as {
        queued: boolean;
        deduplicated?: boolean;
      };
      expect(dedupBody.queued).toBe(false);
      expect(dedupBody.deduplicated).toBe(true);
    }
  });

  it('enforces SRI_INTERNAL_ADMIN_KEY (403 without key, 202 with X-Internal-Key) on POST /v1/taxpayers/sync', async () => {
    process.env.SRI_INTERNAL_ADMIN_KEY = 'e2e-internal-admin-secret';
    try {
      const forbiddenRes = await fetch(`${baseUrl}/taxpayers/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKeyClientA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: 'RIMPE', force: true }),
      });
      expect(forbiddenRes.status).toBe(403);

      const allowedRes = await fetch(`${baseUrl}/taxpayers/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKeyClientA}`,
          'Content-Type': 'application/json',
          'X-Internal-Key': 'e2e-internal-admin-secret',
        },
        body: JSON.stringify({ source: 'RIMPE', force: true }),
      });
      expect(allowedRes.status).toBe(202);
    } finally {
      delete process.env.SRI_INTERNAL_ADMIN_KEY;
    }
  });

  it('reconciles real Postgres rows and invalidates Redis cache when a taxpayer is removed from AGENTS CSV (H-05)', async () => {
    const realSync = new CkanSyncService(prisma, redis);

    // Ensure buyerAgentRuc is currently cached in Redis as an active withholding agent
    const beforeRes = await fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    expect(beforeRes.status).toBe(200);
    const beforeProfile = (await beforeRes.json()) as Record<string, unknown>;
    expect(beforeProfile.esAgenteRetencion).toBe(true);
    expect(beforeProfile.esContribuyenteEspecial).toBe(true);

    // Mock CKAN HTTP responses: AGENTS CSV contains ONLY sellerGeneralRuc (buyerAgentRuc removed!)
    const getSpy = vi
      .spyOn(axiosCjs, 'get')
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            id: 'catastro-agentes-de-retencion',
            metadata_modified: '2026-11-15T10:00:00Z',
            resources: [
              {
                id: 'res-agents-e2e',
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/e2e/download/agentes.csv',
                last_modified: '2026-11-15T10:00:00Z',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from([
          `NUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n${sellerGeneralRuc};PROVEEDOR GENERAL E2E S.A.;RES-NEW-1\n`,
        ]),
      });
    const headSpy = vi.spyOn(axiosCjs, 'head').mockResolvedValueOnce({
      status: 200,
      headers: { etag: '"e2e-agents-v2"' },
    });

    try {
      const syncResult = await realSync.syncSource('AGENTS', true);
      expect(syncResult.status).toBe('SUCCEEDED');
      expect(syncResult.rowCount).toBe(1);
    } finally {
      getSpy.mockRestore();
      headSpy.mockRestore();
    }

    // Redis key for revoked buyerAgentRuc must be invalidated
    const cachedRaw = await redis.get(`sri:taxpayer:${buyerAgentRuc}`);
    expect(cachedRaw).toBeNull();

    // Postgres row for buyerAgentRuc: AGENTS revoked, SPECIAL preserved
    const dbRow = await prisma.sriTaxpayerSpecial.findUnique({ where: { ruc: buyerAgentRuc } });
    expect(dbRow?.isWithholdingAgent).toBe(false);
    expect(dbRow?.inAgentsCatalog).toBe(false);
    expect(dbRow?.withholdingAgentRes).toBeNull();
    expect(dbRow?.isSpecialTaxpayer).toBe(true);
    expect(dbRow?.specialTaxpayerRes).toBe('5368');

    // HTTP lookup now returns esAgenteRetencion: false while preserving esContribuyenteEspecial: true
    const afterRes = await fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    expect(afterRes.status).toBe(200);
    const afterProfile = (await afterRes.json()) as Record<string, unknown>;
    expect(afterProfile.esAgenteRetencion).toBe(false);
    expect(afterProfile.resolucionAgenteRetencion).toBeNull();
    expect(afterProfile.esContribuyenteEspecial).toBe(true);
    expect(afterProfile.resolucionContribuyenteEspecial).toBe('5368');
  });

  it('enforces RateLimitGuard (429 with Retry-After: 1) when client exceeds rateLimitRps', async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${baseUrl}/taxpayers/${buyerAgentRuc}`, {
          headers: { Authorization: `Bearer ${throttledApiKey}` },
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);

    const throttledRes = responses.find((r) => r.status === 429);
    expect(throttledRes?.headers.get('retry-after')).toBe('1');
    const errorBody = (await throttledRes?.json()) as { message: string };
    expect(errorBody.message).toContain('RATE_LIMIT_EXCEEDED');
  });
});
