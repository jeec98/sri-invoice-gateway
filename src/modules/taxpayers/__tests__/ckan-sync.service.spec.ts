import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import axios from 'axios';
import Redis from 'ioredis';
import { SriCatalogSource, SriRegimenType, SriSyncStatus } from '@prisma/client';
import { CkanSyncService } from '../services/ckan-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';

vi.mock('axios');

describe('CkanSyncService (TDD)', () => {
  let service: CkanSyncService;
  let mockPrisma: {
    sriCatalogSyncState: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    sriTaxpayerSpecial: {
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    sriTaxpayerProfile: {
      updateMany: ReturnType<typeof vi.fn>;
    };
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
  let mockRedis: {
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      sriCatalogSyncState: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
      sriTaxpayerSpecial: {
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
      sriTaxpayerProfile: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
    };
    mockRedis = {
      del: vi.fn().mockResolvedValue(1),
    };
    service = new CkanSyncService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as Redis,
    );
  });

  // 3.1 RED — spec: sri-catastro-gateway/spec.md Scenario: Omisión de descarga cuando CKAN y cabeceras HTTP no presentan cambios
  it('skips CSV download and only updates lastCheckedAt when CKAN metadata_modified and HTTP HEAD ETag/Last-Modified match', async () => {
    const existingSyncDate = new Date('2026-11-10T05:05:00Z');
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      resourceId: 'res-agents-1',
      resourceUrl:
        'https://datosabiertos.gob.ec/dataset/agentes/resource/res-agents-1/download/agentes.csv',
      etag: '"abc-123"',
      lastModified: 'Tue, 10 Nov 2026 05:00:00 GMT',
      remoteModifiedAt: '2026-11-10T05:00:00Z',
      rowCount: 12000,
      status: 'SUCCEEDED',
      lastSyncedAt: existingSyncDate,
    });

    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        result: {
          id: 'catastro-agentes-de-retencion',
          metadata_modified: '2026-11-10T05:00:00Z',
          resources: [
            {
              id: 'res-agents-1',
              format: 'XLSX',
              url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/res-xlsx/download/agentes.xlsx',
              last_modified: '2026-11-10T05:00:00Z',
            },
            {
              id: 'res-agents-1',
              format: 'CSV',
              url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/res-agents-1/download/agentes.csv',
              last_modified: '2026-11-10T05:00:00Z',
            },
          ],
        },
      },
    });

    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: {
        etag: '"abc-123"',
        'last-modified': 'Tue, 10 Nov 2026 05:00:00 GMT',
      },
    });

    const result = await service.syncSource(SriCatalogSource.AGENTS);

    expect(result).toEqual({
      source: SriCatalogSource.AGENTS,
      skipped: true,
      rowCount: 12000,
      status: 'SKIPPED',
    });

    // Only CKAN package_show GET was called; CSV stream GET was never opened
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.head).toHaveBeenCalledTimes(1);
    expect(mockPrisma.sriCatalogSyncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: SriCatalogSource.AGENTS },
        update: expect.objectContaining({
          lastCheckedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.sriTaxpayerSpecial.upsert).not.toHaveBeenCalled();
  });

  // 3.4 RED — spec: sri-catastro-gateway/spec.md Scenario: Ingesta por streaming y upsert por lotes ante actualización del catálogo
  it('streams UTF-8 BOM CSV with semicolon delimiter and upserts 3500 rows in 4 batches of 1000', async () => {
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.SPECIAL,
      packageSlug: 'contribuyentes-especiales',
      etag: '"old-etag"',
      remoteModifiedAt: '2026-10-01T00:00:00Z',
      rowCount: 3000,
      status: SriSyncStatus.SUCCEEDED,
    });

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            id: 'contribuyentes-especiales',
            metadata_modified: '2026-11-14T12:00:00Z',
            resources: [
              {
                id: 'res-special-2',
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/ce/resource/res-special-2/download/ce.csv',
                last_modified: '2026-11-14T12:00:00Z',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from(
          (async function* () {
            // UTF-8 BOM + semicolon-delimited header
            yield Buffer.from('\uFEFFNUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n', 'utf8');
            for (let i = 1; i <= 3500; i++) {
              const ruc = `179${String(i).padStart(7, '0')}001`;
              yield Buffer.from(`${ruc};EMPRESA ESPECIAL ${i};RES-${i}\n`, 'utf8');
            }
          })(),
        ),
      });

    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: {
        etag: '"new-etag-3500"',
        'last-modified': 'Fri, 14 Nov 2026 12:00:00 GMT',
      },
    });

    const result = await service.syncSource(SriCatalogSource.SPECIAL);

    expect(result).toEqual({
      source: SriCatalogSource.SPECIAL,
      skipped: false,
      rowCount: 3500,
      status: 'SUCCEEDED',
    });

    // 3500 rows / BATCH_SIZE(1000) = 4 SQL batch upserts
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(4);
    expect(mockPrisma.sriCatalogSyncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: SriCatalogSource.SPECIAL },
        update: expect.objectContaining({
          rowCount: 3500,
          status: SriSyncStatus.SUCCEEDED,
          fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          etag: '"new-etag-3500"',
          lastSyncedAt: expect.any(Date),
        }),
      }),
    );
  });

  // 3.7 RED — spec: sri-catastro-gateway/spec.md Scenarios: Preservación de instantánea previa & Exclusión de ingesta masiva provincial
  it('aborts on invalid CSV headers, mid-stream HTTP errors, or non-allowlisted SSRF URLs, marks status FAILED, preserves previous rows, and never configures provincial RUC dumps', async () => {
    // 1) Assert provincial dumps are never configured
    const configuredSources = service.getConfiguredSources();
    expect(configuredSources).toEqual([
      SriCatalogSource.AGENTS,
      SriCatalogSource.SPECIAL,
      SriCatalogSource.RIMPE,
    ]);

    // 2) SSRF non-allowlisted resource URL returned by CKAN
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      rowCount: 12000,
      status: SriSyncStatus.SUCCEEDED,
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        result: {
          resources: [
            { format: 'CSV', url: 'http://169.254.169.254/latest/meta-data/agentes.csv' },
          ],
        },
      },
    });

    const ssrfResult = await service.syncSource(SriCatalogSource.AGENTS);
    expect(ssrfResult.status).toBe('FAILED');
    expect(axios.head).not.toHaveBeenCalled();
    expect(mockPrisma.sriCatalogSyncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: SriCatalogSource.AGENTS },
        update: expect.objectContaining({
          status: SriSyncStatus.FAILED,
          lastError: expect.stringContaining('SSRF'),
        }),
      }),
    );

    // 3) Invalid CSV headers (missing RUC column)
    vi.clearAllMocks();
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      rowCount: 12000,
      status: SriSyncStatus.SUCCEEDED,
    });
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/1/download/agentes.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from(['COLUMNA_DESCONOCIDA;OTRA_COLUMNA\nVALOR1;VALOR2\n']),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const invalidHeaderResult = await service.syncSource(SriCatalogSource.AGENTS);
    expect(invalidHeaderResult.status).toBe('FAILED');
    expect(invalidHeaderResult.rowCount).toBe(12000);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();

    // 4) Mid-stream HTTP error
    vi.clearAllMocks();
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      rowCount: 12000,
      status: SriSyncStatus.SUCCEEDED,
    });
    const brokenStream = new Readable({
      read() {
        this.push('NUMERO_RUC;RAZON_SOCIAL\n1790016919001;FAVORITA\n');
        this.destroy(new Error('ECONNRESET mid-stream'));
      },
    });
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/1/download/agentes.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ status: 200, data: brokenStream });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const brokenResult = await service.syncSource(SriCatalogSource.AGENTS);
    expect(brokenResult.status).toBe('FAILED');
    expect(brokenResult.rowCount).toBe(12000);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  // H-05 RED — spec: reconciliation revokes removed RUCs only after full stream succeeds and invalidates caches
  it('reconciles and revokes removed AGENTS RUCs (plus stale DB profile and Redis keys) after full CSV stream succeeds without touching SPECIAL or RIMPE flags', async () => {
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { ruc: '1799999999001' },
      { ruc: '1798888888001' },
    ]);

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            id: 'catastro-agentes-de-retencion',
            metadata_modified: '2026-11-15T06:00:00Z',
            resources: [
              {
                id: 'res-agents-3',
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/3/download/agentes.csv',
                last_modified: '2026-11-15T06:00:00Z',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from(['NUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n1790016919001;FAVORITA;RES-1\n']),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: { etag: '"agents-v3"' },
    });

    const result = await service.syncSource(SriCatalogSource.AGENTS);
    expect(result.status).toBe('SUCCEEDED');

    // Batch upsert must stamp agents_batch_id
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [insertSql] = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(insertSql).toContain('agents_batch_id');
    expect(insertSql).not.toContain('special_batch_id');

    // Post-stream reconciliation must revoke stale AGENTS rows and return revoked RUCs
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [revokeSql, batchIdParam] = mockPrisma.$queryRawUnsafe.mock.calls[0];
    expect(revokeSql).toContain('is_withholding_agent = false');
    expect(revokeSql).toContain('in_agents_catalog = false');
    expect(revokeSql).toContain('withholding_agent_res = NULL');
    expect(revokeSql).toContain('agents_batch_id');
    expect(revokeSql).toContain('RETURNING ruc');
    expect(revokeSql).not.toContain('is_special_taxpayer');
    expect(revokeSql).not.toContain('in_rimpe_catalog');
    expect(typeof batchIdParam).toBe('string');
    expect(batchIdParam.length).toBeGreaterThan(10);

    // Clear stale flags on L2 sri_taxpayer_profiles for revoked RUCs
    expect(mockPrisma.sriTaxpayerProfile.updateMany).toHaveBeenCalledWith({
      where: { ruc: { in: ['1799999999001', '1798888888001'] } },
      data: { isWithholdingAgent: false, withholdingAgentRes: null },
    });

    // Invalidate Redis keys (for both upserted and revoked RUCs without using KEYS *)
    expect(mockRedis.del).toHaveBeenCalledWith(
      'sri:taxpayer:1799999999001',
      'sri:taxpayer:1798888888001',
    );
  });

  // H-05 — RIMPE and SPECIAL reconciliation reset only their own columns
  it('revokes removed RIMPE (resetting regimen=GENERAL) and SPECIAL rows independently without touching other catalog flags', async () => {
    // 1) RIMPE revocation
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ ruc: '1710034065001' }]);

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                id: 'res-rimpe-1',
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/rimpe/resource/1/download/rimpe.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from([
          'NUMERO_RUC;RAZON_SOCIAL;REGIMEN\n1790011674001;EMPRESA RIMPE;RIMPE EMPRENDEDOR\n',
        ]),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const rimpeRes = await service.syncSource(SriCatalogSource.RIMPE);
    expect(rimpeRes.status).toBe('SUCCEEDED');

    const [rimpeRevokeSql] = mockPrisma.$queryRawUnsafe.mock.calls[0];
    expect(rimpeRevokeSql).toContain('in_rimpe_catalog = false');
    expect(rimpeRevokeSql).toContain(`regimen = 'GENERAL'::"SriRegimenType"`);
    expect(rimpeRevokeSql).toContain('rimpe_batch_id');
    expect(rimpeRevokeSql).not.toContain('is_withholding_agent');
    expect(rimpeRevokeSql).not.toContain('is_special_taxpayer');
    expect(mockPrisma.sriTaxpayerProfile.updateMany).toHaveBeenCalledWith({
      where: { ruc: { in: ['1710034065001'] } },
      data: { regimen: SriRegimenType.GENERAL },
    });

    // 2) SPECIAL revocation
    vi.clearAllMocks();
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ ruc: '1790016919001' }]);

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                id: 'res-special-1',
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/ce/resource/1/download/ce.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from([
          'NUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n1790011674001;OTRA ESPECIAL;RES-55\n',
        ]),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const specialRes = await service.syncSource(SriCatalogSource.SPECIAL);
    expect(specialRes.status).toBe('SUCCEEDED');

    const [specialRevokeSql] = mockPrisma.$queryRawUnsafe.mock.calls[0];
    expect(specialRevokeSql).toContain('is_special_taxpayer = false');
    expect(specialRevokeSql).toContain('in_special_catalog = false');
    expect(specialRevokeSql).toContain('special_taxpayer_res = NULL');
    expect(specialRevokeSql).toContain('special_batch_id');
    expect(specialRevokeSql).not.toContain('is_withholding_agent');
    expect(specialRevokeSql).not.toContain('in_rimpe_catalog');
    expect(mockPrisma.sriTaxpayerProfile.updateMany).toHaveBeenCalledWith({
      where: { ruc: { in: ['1790016919001'] } },
      data: { isSpecialTaxpayer: false, specialTaxpayerRes: null },
    });
  });

  // H-05 — 304 Not Modified, mid-stream failure after partial batch, and empty 0-row CSV never revoke rows
  it('never revokes existing rows or deletes Redis keys on 304 Not Modified, mid-stream failure after batch 1, or empty 0-row CSV', async () => {
    // 1) HTTP 304 Not Modified on GET stream
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      etag: '"etag-prev"',
      lastModified: 'Tue, 10 Nov 2026 05:00:00 GMT',
      remoteModifiedAt: '2026-11-10T05:00:00Z',
      rowCount: 1500,
      status: SriSyncStatus.SUCCEEDED,
    });

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            metadata_modified: '2026-11-14T00:00:00Z', // Changed CKAN timestamp triggers GET
            resources: [
              {
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/1/download/agentes.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 304,
        data: Readable.from([]),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: { etag: '"etag-prev"' },
    });

    const notModResult = await service.syncSource(SriCatalogSource.AGENTS);
    expect(notModResult).toEqual({
      source: SriCatalogSource.AGENTS,
      skipped: true,
      rowCount: 1500,
      status: 'SKIPPED',
    });
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();

    // 2) Mid-stream failure AFTER batch 1 (1000 rows) flushed must NOT reconcile/revoke
    vi.clearAllMocks();
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      rowCount: 1500,
      status: SriSyncStatus.SUCCEEDED,
    });
    const partialBrokenStream = Readable.from(
      (async function* () {
        yield Buffer.from('NUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n', 'utf8');
        for (let i = 1; i <= 1050; i++) {
          const ruc = `179${String(i).padStart(7, '0')}001`;
          yield Buffer.from(`${ruc};EMPRESA ${i};RES-${i}\n`, 'utf8');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new Error('Stream aborted after batch 1');
      })(),
    );
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/1/download/agentes.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ status: 200, data: partialBrokenStream });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const partialFail = await service.syncSource(SriCatalogSource.AGENTS);
    expect(partialFail.status).toBe('FAILED');
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();

    // 3) Empty 0-row CSV (header only) aborts without revoking
    vi.clearAllMocks();
    mockPrisma.sriCatalogSyncState.findUnique.mockResolvedValueOnce({
      source: SriCatalogSource.AGENTS,
      packageSlug: 'catastro-agentes-de-retencion',
      rowCount: 1500,
      status: SriSyncStatus.SUCCEEDED,
    });
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          result: {
            resources: [
              {
                format: 'CSV',
                url: 'https://datosabiertos.gob.ec/dataset/agentes/resource/1/download/agentes.csv',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Readable.from(['NUMERO_RUC;RAZON_SOCIAL;RESOLUCION\n']),
      });
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });

    const emptyFail = await service.syncSource(SriCatalogSource.AGENTS);
    expect(emptyFail.status).toBe('FAILED');
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
