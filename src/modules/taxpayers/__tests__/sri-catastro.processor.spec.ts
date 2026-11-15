import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SriCatastroProcessor } from '../processors/sri-catastro.processor';
import { CkanSyncService } from '../services/ckan-sync.service';
import { SRI_CATASTRO_QUEUE } from '../taxpayers.constants';

describe('SriCatastroProcessor (TDD)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('configures BullMQ worker options with concurrency: 1, lockDuration >= 300_000, and stalledInterval >= 120_000', () => {
    const metadataKeys = Reflect.getMetadataKeys(SriCatastroProcessor);
    const allMeta = metadataKeys.map((k) => Reflect.getMetadata(k, SriCatastroProcessor));
    const processorMeta = allMeta.find(
      (m) => m && typeof m === 'object' && m.name === SRI_CATASTRO_QUEUE,
    ) as Record<string, unknown> | undefined;
    const workerMeta = allMeta.find((m) => m && typeof m === 'object' && 'concurrency' in m) as
      Record<string, unknown> | undefined;

    expect(processorMeta).toBeDefined();
    expect(workerMeta).toBeDefined();
    expect(workerMeta?.concurrency).toBe(1);
    expect(Number(workerMeta?.lockDuration)).toBeGreaterThanOrEqual(300_000);
    expect(Number(workerMeta?.stalledInterval)).toBeGreaterThanOrEqual(120_000);
  });

  it('uses deterministic jobId and removeOnComplete: true when SRI_CATASTRO_SYNC_ON_BOOT=true', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SRI_CATASTRO_SYNC_ENABLED = 'true';
    process.env.SRI_CATASTRO_SYNC_ON_BOOT = 'true';

    const mockCkan = { syncAll: vi.fn(), syncSource: vi.fn() } as unknown as CkanSyncService;
    const mockQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue({ id: 'sync-sri-catalogs-ALL' }),
    };

    const processor = new SriCatastroProcessor(mockCkan, mockQueue as never);
    await processor.onModuleInit();

    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-sri-catalogs',
      { source: 'ALL', force: false },
      expect.objectContaining({
        jobId: 'sync-sri-catalogs-ALL',
        removeOnComplete: true,
      }),
    );
  });
});
