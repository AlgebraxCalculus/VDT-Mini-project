import { WeatherSource } from '../entities/weather-snapshot.entity';
import { ForecastResult, ForecastTarget } from '../types/normalized-forecast';

/**
 * Anything the healthcheck monitor (API 35) can probe. All four external
 * sources implement this; only the three forecast sources also implement
 * {@link ForecastProvider}.
 */
export interface HealthCheckable {
  readonly code: WeatherSource;
  /** Does this source require an API key to be usable? */
  readonly requiresKey: boolean;
  /** Usable now? (keyless, or its key is configured). */
  isConfigured(): boolean;
  /**
   * Lightweight liveness probe. Resolves with latency ms; throws on failure.
   * `timeoutMs` lets the healthcheck use a shorter budget than data fetches so a
   * blocked/unreachable source doesn't stall the whole check.
   */
  ping(timeoutMs?: number): Promise<number>;
}

/**
 * A source that returns a 5–7 day weather time-series. Ordered into the fallback
 * chain Open-Meteo → OWM → WeatherAPI. `fetchForecast` throws on failure so the
 * ingestion flow falls through to the next configured provider.
 */
export interface ForecastProvider extends HealthCheckable {
  fetchForecast(targets: ForecastTarget[], days: number): Promise<ForecastResult>;
}
