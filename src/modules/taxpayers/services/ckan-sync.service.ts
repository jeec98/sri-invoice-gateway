import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SriCatalogSource,
  SriCatalogSyncState,
  SriRegimenType,
  SriSyncStatus,
} from '@prisma/client';
import axios from 'axios';
import { parse } from 'csv-parse';
import Redis from 'ioredis';
import * as crypto from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { CATASTRO_BATCH_SIZE, SRI_TAXPAYER_CACHE_PREFIX } from '../taxpayers.constants';
import { assertSafeSriUrl } from '../utils/sri-ssrf-guard.util';

export interface SyncSourceResult {
  source: SriCatalogSource;
  skipped: boolean;
  rowCount: number;
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
}

interface CkanResource {
  id?: string;
  format?: string;
  url?: string;
  last_modified?: string;
}

interface CkanPackageResponse {
  success?: boolean;
  result?: {
    id?: string;
    metadata_modified?: string;
    resources?: CkanResource[];
  };
}

interface DiscoveredResource {
  resourceId: string | null;
  resourceUrl: string;
  remoteModifiedAt: string | null;
}

interface RemoteHeadMetadata {
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
}

interface ParsedCatalogRow {
  ruc: string;
  razonSocial: string | null;
  resolution: string | null;
  regimen: SriRegimenType;
}

const CATALOG_PACKAGE_SLUGS: Record<SriCatalogSource, string> = {
  [SriCatalogSource.AGENTS]: 'catastro-agentes-de-retencion',
  [SriCatalogSource.SPECIAL]: 'contribuyentes-especiales',
  [SriCatalogSource.RIMPE]: 'catastro-rimpe',
};

const CKAN_BASE_URL = 'https://datosabiertos.gob.ec/api/3/action/package_show';
const HTTP_METADATA_TIMEOUT_MS = 15_000;
const HTTP_STREAM_TIMEOUT_MS = 120_000;

const CSV_HEADER_ALIASES = {
  ruc: ['NUMERO_RUC', 'RUC', 'IDENTIFICACION'],
  razonSocial: ['RAZON_SOCIAL', 'NOMBRE_RAZON_SOCIAL', 'CONTRIBUYENTE'],
  resolution: ['RESOLUCION', 'NUMERO_RESOLUCION', 'NO_RESOLUCION'],
  regimen: ['REGIMEN', 'TIPO_REGIMEN', 'CATEGORIA'],
} as const;

const BATCH_COLUMN_BY_SOURCE: Record<SriCatalogSource, string> = {
  [SriCatalogSource.AGENTS]: 'agents_batch_id',
  [SriCatalogSource.SPECIAL]: 'special_batch_id',
  [SriCatalogSource.RIMPE]: 'rimpe_batch_id',
};

const CONFLICT_UPDATE_BY_SOURCE: Record<SriCatalogSource, string> = {
  [SriCatalogSource.AGENTS]: `
    is_withholding_agent = true,
    in_agents_catalog = true,
    withholding_agent_res = COALESCE(EXCLUDED.withholding_agent_res, sri_taxpayer_specials.withholding_agent_res),
    razon_social = COALESCE(EXCLUDED.razon_social, sri_taxpayer_specials.razon_social),
    agents_batch_id = EXCLUDED.agents_batch_id,
    updated_at = NOW()`,
  [SriCatalogSource.SPECIAL]: `
    is_special_taxpayer = true,
    in_special_catalog = true,
    special_taxpayer_res = COALESCE(EXCLUDED.special_taxpayer_res, sri_taxpayer_specials.special_taxpayer_res),
    razon_social = COALESCE(EXCLUDED.razon_social, sri_taxpayer_specials.razon_social),
    special_batch_id = EXCLUDED.special_batch_id,
    updated_at = NOW()`,
  [SriCatalogSource.RIMPE]: `
    regimen = EXCLUDED.regimen,
    in_rimpe_catalog = true,
    razon_social = COALESCE(EXCLUDED.razon_social, sri_taxpayer_specials.razon_social),
    rimpe_batch_id = EXCLUDED.rimpe_batch_id,
    updated_at = NOW()`,
};

const REVOKE_SQL_BY_SOURCE: Record<SriCatalogSource, string> = {
  [SriCatalogSource.AGENTS]: `
    UPDATE sri_taxpayer_specials
    SET is_withholding_agent = false,
        in_agents_catalog = false,
        withholding_agent_res = NULL,
        updated_at = NOW()
    WHERE (in_agents_catalog = true OR is_withholding_agent = true)
      AND (agents_batch_id IS NULL OR agents_batch_id <> $1)
    RETURNING ruc
  `,
  [SriCatalogSource.SPECIAL]: `
    UPDATE sri_taxpayer_specials
    SET is_special_taxpayer = false,
        in_special_catalog = false,
        special_taxpayer_res = NULL,
        updated_at = NOW()
    WHERE (in_special_catalog = true OR is_special_taxpayer = true)
      AND (special_batch_id IS NULL OR special_batch_id <> $1)
    RETURNING ruc
  `,
  [SriCatalogSource.RIMPE]: `
    UPDATE sri_taxpayer_specials
    SET in_rimpe_catalog = false,
        regimen = 'GENERAL'::"SriRegimenType",
        updated_at = NOW()
    WHERE (in_rimpe_catalog = true OR regimen <> 'GENERAL'::"SriRegimenType")
      AND (rimpe_batch_id IS NULL OR rimpe_batch_id <> $1)
    RETURNING ruc
  `,
};

const REDIS_INVALIDATE_CHUNK_SIZE = 500;

@Injectable()
export class CkanSyncService {
  private readonly logger = new Logger(CkanSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  getConfiguredSources(): SriCatalogSource[] {
    return Object.keys(CATALOG_PACKAGE_SLUGS) as SriCatalogSource[];
  }

  async syncSource(source: SriCatalogSource, force = false): Promise<SyncSourceResult> {
    const packageSlug = CATALOG_PACKAGE_SLUGS[source];
    const existing = await this.prisma.sriCatalogSyncState.findUnique({
      where: { source },
    });

    try {
      const discovered = await this.discoverCsvResource(packageSlug);
      assertSafeSriUrl(discovered.resourceUrl);

      const headMeta = await this.fetchRemoteHeaders(discovered.resourceUrl);

      if (!force && this.isRemoteUnchanged(existing, discovered, headMeta)) {
        await this.markCheckedOnly(source, packageSlug, discovered, headMeta, existing!);
        this.logger.log(`Skipped download for ${source}: metadata unchanged`);
        return {
          source,
          skipped: true,
          rowCount: existing!.rowCount,
          status: 'SKIPPED',
        };
      }

      const syncBatchId = crypto.randomUUID();
      const streamOutcome = await this.streamAndUpsertCatalog(
        source,
        discovered.resourceUrl,
        syncBatchId,
        force ? null : existing,
      );

      if (streamOutcome.notModified) {
        await this.markCheckedOnly(source, packageSlug, discovered, headMeta, existing!);
        this.logger.log(`Skipped download for ${source}: HTTP 304 Not Modified`);
        return {
          source,
          skipped: true,
          rowCount: existing?.rowCount ?? 0,
          status: 'SKIPPED',
        };
      }

      const { rowCount, fileSha256 } = streamOutcome;
      const revokedCount = await this.reconcileStaleRows(source, syncBatchId);

      const now = new Date();
      await this.prisma.sriCatalogSyncState.upsert({
        where: { source },
        create: {
          source,
          packageSlug,
          resourceId: discovered.resourceId,
          resourceUrl: discovered.resourceUrl,
          etag: headMeta.etag,
          lastModified: headMeta.lastModified,
          remoteModifiedAt: discovered.remoteModifiedAt,
          contentLength: headMeta.contentLength,
          fileSha256,
          rowCount,
          status: SriSyncStatus.SUCCEEDED,
          lastError: null,
          lastCheckedAt: now,
          lastSyncedAt: now,
        },
        update: {
          packageSlug,
          resourceId: discovered.resourceId,
          resourceUrl: discovered.resourceUrl,
          etag: headMeta.etag,
          lastModified: headMeta.lastModified,
          remoteModifiedAt: discovered.remoteModifiedAt,
          contentLength: headMeta.contentLength,
          fileSha256,
          rowCount,
          status: SriSyncStatus.SUCCEEDED,
          lastError: null,
          lastCheckedAt: now,
          lastSyncedAt: now,
        },
      });

      this.logger.log(`Synced ${source}: ${rowCount} rows (revoked ${revokedCount} stale rows)`);
      return {
        source,
        skipped: false,
        rowCount,
        status: 'SUCCEEDED',
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed syncing ${source}: ${errMsg}`);

      await this.prisma.sriCatalogSyncState.upsert({
        where: { source },
        create: {
          source,
          packageSlug,
          rowCount: existing?.rowCount ?? 0,
          status: SriSyncStatus.FAILED,
          lastError: errMsg.slice(0, 1000),
          lastCheckedAt: new Date(),
          lastSyncedAt: existing?.lastSyncedAt ?? null,
        },
        update: {
          status: SriSyncStatus.FAILED,
          lastError: errMsg.slice(0, 1000),
          lastCheckedAt: new Date(),
        },
      });

      return {
        source,
        skipped: false,
        rowCount: existing?.rowCount ?? 0,
        status: 'FAILED',
      };
    }
  }

  async syncAll(force = false): Promise<SyncSourceResult[]> {
    const results: SyncSourceResult[] = [];
    for (const source of this.getConfiguredSources()) {
      results.push(await this.syncSource(source, force));
    }
    return results;
  }

  private async streamAndUpsertCatalog(
    source: SriCatalogSource,
    resourceUrl: string,
    syncBatchId: string,
    existing: SriCatalogSyncState | null,
  ): Promise<{ rowCount: number; fileSha256: string; notModified?: boolean }> {
    const conditionalHeaders: Record<string, string> = {};
    if (existing && existing.status === SriSyncStatus.SUCCEEDED) {
      if (existing.etag) conditionalHeaders['If-None-Match'] = existing.etag;
      if (existing.lastModified) conditionalHeaders['If-Modified-Since'] = existing.lastModified;
    }

    const streamResponse = await axios.get<Readable>(resourceUrl, {
      responseType: 'stream',
      timeout: HTTP_STREAM_TIMEOUT_MS,
      maxRedirects: 0,
      ...(Object.keys(conditionalHeaders).length > 0 ? { headers: conditionalHeaders } : {}),
      validateStatus: (status) => status === 200 || status === 304,
    });

    if (streamResponse.status === 304) {
      streamResponse.data?.destroy?.();
      return {
        rowCount: existing?.rowCount ?? 0,
        fileSha256: existing?.fileSha256 ?? '',
        notModified: true,
      };
    }

    const hash = crypto.createHash('sha256');
    const teeStream = new PassThrough();
    const parser = parse({
      bom: true,
      delimiter: [';', ','],
      columns: (headers: string[]) => {
        const normalized = headers.map((h) => this.normalizeCsvKey(String(h)));
        const hasRuc = normalized.some((col) =>
          (CSV_HEADER_ALIASES.ruc as readonly string[]).includes(col),
        );
        if (!hasRuc) {
          throw new Error(
            `INVALID_CSV_SCHEMA: Missing required RUC column in headers [${normalized.join(', ')}]`,
          );
        }
        return normalized;
      },
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    streamResponse.data.on('data', (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    streamResponse.data.on('error', (err) => {
      teeStream.destroy(err);
      parser.destroy(err);
    });
    teeStream.on('error', (err) => {
      parser.destroy(err);
    });
    streamResponse.data.pipe(teeStream).pipe(parser);

    let batch: ParsedCatalogRow[] = [];
    let rowCount = 0;

    for await (const rawRecord of parser as AsyncIterable<Record<string, string>>) {
      const parsed = this.mapRecordToRow(source, rawRecord);
      if (!parsed) continue;
      batch.push(parsed);
      rowCount++;

      if (batch.length >= CATASTRO_BATCH_SIZE) {
        await this.flushBatch(source, batch, syncBatchId);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await this.flushBatch(source, batch, syncBatchId);
    }

    if (rowCount === 0) {
      throw new Error(`EMPTY_CATALOG_CSV: Refusing to reconcile 0 rows for ${source}`);
    }

    return {
      rowCount,
      fileSha256: hash.digest('hex'),
    };
  }

  private normalizeCsvKey(rawKey: string): string {
    return rawKey
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private pickAliasValue(normalized: Record<string, string>, aliases: readonly string[]): string {
    for (const key of aliases) {
      if (normalized[key]) {
        return normalized[key];
      }
    }
    return '';
  }

  private mapRecordToRow(
    source: SriCatalogSource,
    raw: Record<string, string>,
  ): ParsedCatalogRow | null {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      normalized[this.normalizeCsvKey(k)] = typeof v === 'string' ? v.trim() : '';
    }

    const rucRaw = this.pickAliasValue(normalized, CSV_HEADER_ALIASES.ruc);
    if (!/^\d{13}$/.test(rucRaw)) {
      return null;
    }

    const razonSocial = this.pickAliasValue(normalized, CSV_HEADER_ALIASES.razonSocial) || null;
    const resolution = this.pickAliasValue(normalized, CSV_HEADER_ALIASES.resolution) || null;

    let regimen: SriRegimenType = SriRegimenType.GENERAL;
    if (source === SriCatalogSource.RIMPE) {
      const regRaw = this.pickAliasValue(normalized, CSV_HEADER_ALIASES.regimen).toUpperCase();
      regimen = regRaw.includes('POPULAR')
        ? SriRegimenType.RIMPE_NEGOCIO_POPULAR
        : SriRegimenType.RIMPE_EMPRENDEDOR;
    }

    return { ruc: rucRaw, razonSocial, resolution, regimen };
  }

  private async flushBatch(
    source: SriCatalogSource,
    batch: ParsedCatalogRow[],
    syncBatchId: string,
  ): Promise<void> {
    if (batch.length === 0) return;

    const deduplicated = new Map<string, ParsedCatalogRow>();
    for (const row of batch) {
      deduplicated.set(row.ruc, row);
    }
    const rows = Array.from(deduplicated.values());

    const params: unknown[] = [];
    const valuesSql: string[] = [];
    const batchCol = BATCH_COLUMN_BY_SOURCE[source];

    rows.forEach((row, idx) => {
      const base = idx * 11;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}::"SriRegimenType", $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, NOW())`,
      );
      params.push(
        row.ruc,
        row.razonSocial,
        row.regimen,
        source === SriCatalogSource.SPECIAL,
        source === SriCatalogSource.SPECIAL ? row.resolution : null,
        source === SriCatalogSource.AGENTS,
        source === SriCatalogSource.AGENTS ? row.resolution : null,
        source === SriCatalogSource.AGENTS,
        source === SriCatalogSource.SPECIAL,
        source === SriCatalogSource.RIMPE,
        syncBatchId,
      );
    });

    const sql = `
      INSERT INTO sri_taxpayer_specials (
        ruc,
        razon_social,
        regimen,
        is_special_taxpayer,
        special_taxpayer_res,
        is_withholding_agent,
        withholding_agent_res,
        in_agents_catalog,
        in_special_catalog,
        in_rimpe_catalog,
        ${batchCol},
        updated_at
      )
      VALUES ${valuesSql.join(', ')}
      ON CONFLICT (ruc) DO UPDATE SET ${CONFLICT_UPDATE_BY_SOURCE[source]}
    `;

    await this.prisma.$executeRawUnsafe(sql, ...params);
    await this.invalidateRedisKeys(rows.map((r) => r.ruc));
  }

  private async reconcileStaleRows(source: SriCatalogSource, syncBatchId: string): Promise<number> {
    if (typeof this.prisma.$queryRawUnsafe !== 'function') {
      return 0;
    }

    const revoked = await this.prisma.$queryRawUnsafe<Array<{ ruc: string }>>(
      REVOKE_SQL_BY_SOURCE[source],
      syncBatchId,
    );
    const revokedRucs = Array.from(new Set((revoked ?? []).map((r) => r.ruc).filter(Boolean)));

    if (revokedRucs.length === 0) {
      return 0;
    }

    await this.clearStaleDbProfiles(source, revokedRucs);
    await this.invalidateRedisKeys(revokedRucs);

    return revokedRucs.length;
  }

  private async clearStaleDbProfiles(source: SriCatalogSource, rucs: string[]): Promise<void> {
    if (!this.prisma.sriTaxpayerProfile?.updateMany || rucs.length === 0) {
      return;
    }

    const data =
      source === SriCatalogSource.AGENTS
        ? { isWithholdingAgent: false, withholdingAgentRes: null }
        : source === SriCatalogSource.SPECIAL
          ? { isSpecialTaxpayer: false, specialTaxpayerRes: null }
          : { regimen: SriRegimenType.GENERAL };

    for (let i = 0; i < rucs.length; i += REDIS_INVALIDATE_CHUNK_SIZE) {
      const chunk = rucs.slice(i, i + REDIS_INVALIDATE_CHUNK_SIZE);
      await this.prisma.sriTaxpayerProfile.updateMany({
        where: { ruc: { in: chunk } },
        data,
      });
    }
  }

  private async invalidateRedisKeys(rucs: string[]): Promise<void> {
    if (!this.redis || typeof this.redis.del !== 'function' || rucs.length === 0) {
      return;
    }

    try {
      for (let i = 0; i < rucs.length; i += REDIS_INVALIDATE_CHUNK_SIZE) {
        const keys = rucs
          .slice(i, i + REDIS_INVALIDATE_CHUNK_SIZE)
          .map((ruc) => `${SRI_TAXPAYER_CACHE_PREFIX}${ruc}`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Redis cache invalidation error: ${(err as Error)?.message}`);
    }
  }

  private async discoverCsvResource(packageSlug: string): Promise<DiscoveredResource> {
    const packageUrl = `${CKAN_BASE_URL}?id=${encodeURIComponent(packageSlug)}`;
    assertSafeSriUrl(packageUrl);

    const pkgResponse = await axios.get<CkanPackageResponse>(packageUrl, {
      timeout: HTTP_METADATA_TIMEOUT_MS,
      maxRedirects: 0,
    });

    const pkgResult = pkgResponse.data?.result;
    const resources = pkgResult?.resources ?? [];
    const csvResource =
      resources.find((r) => r.format?.toUpperCase() === 'CSV' && r.url) ??
      resources.find((r) => r.url?.toLowerCase().endsWith('.csv'));

    if (!csvResource?.url) {
      throw new Error(`No CSV resource found in CKAN package ${packageSlug}`);
    }

    return {
      resourceId: csvResource.id ?? null,
      resourceUrl: csvResource.url,
      remoteModifiedAt: csvResource.last_modified ?? pkgResult?.metadata_modified ?? null,
    };
  }

  private async fetchRemoteHeaders(resourceUrl: string): Promise<RemoteHeadMetadata> {
    const headResponse = await axios.head(resourceUrl, {
      timeout: HTTP_METADATA_TIMEOUT_MS,
      maxRedirects: 0,
    });

    const contentLengthRaw = this.readNormalizedHeader(headResponse.headers, 'content-length');
    const parsedLength = contentLengthRaw ? Number(contentLengthRaw) : NaN;

    return {
      etag: this.readNormalizedHeader(headResponse.headers, 'etag'),
      lastModified: this.readNormalizedHeader(headResponse.headers, 'last-modified'),
      contentLength: Number.isFinite(parsedLength) ? parsedLength : null,
    };
  }

  private readNormalizedHeader(
    headers: Record<string, unknown> | undefined,
    name: string,
  ): string | null {
    if (!headers) return null;
    const lowerTarget = name.toLowerCase();
    for (const [key, val] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerTarget && typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    }
    return null;
  }

  private isRemoteUnchanged(
    existing: SriCatalogSyncState | null,
    discovered: DiscoveredResource,
    headMeta: RemoteHeadMetadata,
  ): boolean {
    if (!existing || existing.status !== SriSyncStatus.SUCCEEDED) {
      return false;
    }

    const hasRemoteSignal = Boolean(
      discovered.remoteModifiedAt || headMeta.etag || headMeta.lastModified,
    );
    if (!hasRemoteSignal) {
      return false;
    }

    const modifiedMatches =
      !discovered.remoteModifiedAt || existing.remoteModifiedAt === discovered.remoteModifiedAt;
    const etagMatches = !headMeta.etag || existing.etag === headMeta.etag;
    const lastModifiedMatches =
      !headMeta.lastModified || existing.lastModified === headMeta.lastModified;

    return modifiedMatches && etagMatches && lastModifiedMatches;
  }

  private async markCheckedOnly(
    source: SriCatalogSource,
    packageSlug: string,
    discovered: DiscoveredResource,
    headMeta: RemoteHeadMetadata,
    existing: SriCatalogSyncState,
  ): Promise<void> {
    await this.prisma.sriCatalogSyncState.upsert({
      where: { source },
      create: {
        source,
        packageSlug,
        resourceId: discovered.resourceId,
        resourceUrl: discovered.resourceUrl,
        etag: headMeta.etag,
        lastModified: headMeta.lastModified,
        remoteModifiedAt: discovered.remoteModifiedAt,
        contentLength: headMeta.contentLength,
        rowCount: existing.rowCount,
        status: existing.status,
        lastCheckedAt: new Date(),
        lastSyncedAt: existing.lastSyncedAt,
      },
      update: {
        lastCheckedAt: new Date(),
      },
    });
  }
}
