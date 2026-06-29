/** BullMQ queue name for weather ingestion jobs (manual refresh + cron ingest). */
export const WEATHER_QUEUE = 'weather';

/** Job names processed by {@link WeatherProcessor}. */
export const WEATHER_JOB = {
  /** API 31 — on-demand manual refresh. */
  REFRESH: 'refresh',
  /** API 34 — scheduled/cron ingestion. */
  INGEST: 'ingest',
} as const;

/** Redis keys for the manual-refresh debounce lock + last-job pointer (API 31). */
export const REFRESH_LOCK_KEY = 'weather:refresh:lock';
export const REFRESH_LAST_KEY = 'weather:refresh:last';

/** Redis key prefix for per-source healthcheck results (API 35). */
export const HEALTH_KEY_PREFIX = 'integrations:health:';

/** DI tokens for the ordered provider collections. */
export const FORECAST_PROVIDERS = Symbol('FORECAST_PROVIDERS');
export const DISASTER_PROVIDERS = Symbol('DISASTER_PROVIDERS');
export const HEALTH_PROVIDERS = Symbol('HEALTH_PROVIDERS');
