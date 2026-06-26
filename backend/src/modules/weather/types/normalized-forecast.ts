/**
 * Provider-agnostic shapes the ingestion flow works in. Each external provider
 * normalizes its own payload into these so the persistence + fallback logic
 * never depends on a specific source's response format.
 */

/** A point to fetch a forecast for: a station OR a province centroid. */
export interface ForecastTarget {
  /** Set when the target is a station (mutually exclusive with provinceId). */
  stationId: number | null;
  /** Set when the target is a province centroid. */
  provinceId: number | null;
  latitude: number;
  longitude: number;
}

/** One normalized time-series sample. Nulls where a provider lacks the field. */
export interface ForecastPoint {
  forecastTime: Date;
  temperature: number | null;
  rainfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  /** River level (Open-Meteo Flood API river_discharge); null for other sources. */
  riverWaterLevel: number | null;
}

/** Forecast series for a single target. */
export interface TargetForecast {
  target: ForecastTarget;
  points: ForecastPoint[];
}

/** What a forecast provider returns for a batch of targets. */
export interface ForecastResult {
  series: TargetForecast[];
  /** Trimmed raw payload sample stored on weather_snapshots.raw_payload. */
  raw: unknown;
}
