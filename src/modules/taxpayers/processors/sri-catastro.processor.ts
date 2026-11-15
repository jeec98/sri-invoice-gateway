import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { SriCatalogSource } from '@prisma/client';
import {
  SRI_CATASTRO_LOCK_DURATION_MS,
  SRI_CATASTRO_QUEUE,
  SRI_CATASTRO_STALLED_INTERVAL_MS,
  SYNC_CATALOGS_JOB,
} from '../taxpayers.constants';
import { CkanSyncService, SyncSourceResult } from '../services/ckan-sync.service';

export interface CatastroSyncJobPayload {
  source?: 'ALL' | SriCatalogSource;
  force?: boolean;
}

@Processor(SRI_CATASTRO_QUEUE, {
  concurrency: 1,
  lockDuration: SRI_CATASTRO_LOCK_DURATION_MS,
  stalledInterval: SRI_CATASTRO_STALLED_INTERVAL_MS,
})
export class SriCatastroProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SriCatastroProcessor.name);

  constructor(
    private readonly ckanSyncService: CkanSyncService,
    @InjectQueue(SRI_CATASTRO_QUEUE) private readonly catastroQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.SRI_CATASTRO_SYNC_ENABLED === 'false') {
      return;
    }

    const pattern = process.env.SRI_CATASTRO_SYNC_CRON || '0 3 * * 1';
    try {
      await this.catastroQueue.upsertJobScheduler(
        'sri-catastro-weekly-sync',
        { pattern },
        {
          name: SYNC_CATALOGS_JOB,
          data: { source: 'ALL', force: false },
          opts: {
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        },
      );
      this.logger.log(`Registered SRI Catastro job scheduler (${pattern})`);

      if (process.env.SRI_CATASTRO_SYNC_ON_BOOT === 'true') {
        await this.catastroQueue.add(
          SYNC_CATALOGS_JOB,
          { source: 'ALL', force: false },
          {
            jobId: `${SYNC_CATALOGS_JOB}-ALL`,
            removeOnComplete: true,
            removeOnFail: 20,
          },
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register SRI Catastro scheduler: ${msg}`);
    }
  }

  async process(job: Job<CatastroSyncJobPayload>): Promise<SyncSourceResult[]> {
    const source = job.data?.source ?? 'ALL';
    const force = Boolean(job.data?.force);

    this.logger.log(
      `Processing SRI Catastro sync job ${job.id} [source=${source}, force=${force}]`,
    );

    if (source === 'ALL') {
      return this.ckanSyncService.syncAll(force);
    }

    const single = await this.ckanSyncService.syncSource(source, force);
    return [single];
  }
}
