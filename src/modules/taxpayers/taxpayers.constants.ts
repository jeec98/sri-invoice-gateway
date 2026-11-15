export const SRI_CATASTRO_QUEUE = 'sri-catastro';
export const SYNC_CATALOGS_JOB = 'sync-sri-catalogs';
export const CATASTRO_BATCH_SIZE = 1000;
export const SRI_CATASTRO_LOCK_DURATION_MS = 300_000;
export const SRI_CATASTRO_STALLED_INTERVAL_MS = 120_000;
export const SRI_CATASTRO_SYNC_COOLDOWN_KEY_PREFIX = 'sri:catastro:sync:cooldown:';
export const SRI_CATASTRO_SYNC_COOLDOWN_SECONDS = 900; // 15m anti-abuse cooldown

export const SRI_TAXPAYER_CACHE_PREFIX = 'sri:taxpayer:';
export const SRI_TAXPAYER_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SRI_DB_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SRI_LIVE_TIMEOUT_MS = 4_000;
export const SRI_LIVE_CIRCUIT_OPEN_KEY = 'sri:live:circuit_open';
export const SRI_LIVE_FAILURE_KEY = 'sri:live:failures';
export const SRI_LIVE_CIRCUIT_COOLDOWN_SECONDS = 900; // 15m cooldown
export const SRI_LIVE_FAILURE_WINDOW_SECONDS = 120;
export const SRI_LIVE_FAILURE_THRESHOLD = 3;
