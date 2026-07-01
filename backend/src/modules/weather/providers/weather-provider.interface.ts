import { WeatherSource } from '../entities/weather-snapshot.entity';
import { ForecastResult, ForecastTarget } from '../types/normalized-forecast';

/** Anything the healthcheck monitor (API 35) can probe. */
export interface HealthCheckable {
  readonly code: WeatherSource;
  readonly requiresKey: boolean;
  /** Usable now (keyless, or key configured). */
  isConfigured(): boolean;
  /** Liveness probe; resolves latency ms, throws on failure. */
  ping(timeoutMs?: number): Promise<number>;
}

/** A 5–7 day forecast source (chain Open-Meteo → MET Norway → WeatherAPI); throws to fall through. */
export interface ForecastProvider extends HealthCheckable {
  fetchForecast(targets: ForecastTarget[], days: number): Promise<ForecastResult>;
}

/** A disaster-event source (chain GDACS → ReliefWeb → EONET); throws to fall through. */
export interface DisasterProvider extends HealthCheckable {
  fetchEvents(): Promise<unknown>;
}
