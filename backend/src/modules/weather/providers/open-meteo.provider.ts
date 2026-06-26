import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import {
  ForecastPoint,
  ForecastResult,
  ForecastTarget,
  TargetForecast,
} from '../types/normalized-forecast';
import { ForecastProvider } from './weather-provider.interface';
import { fetchJson, HttpOptions, pingUrl } from './http.util';

interface OmHourly {
  time: string[];
  temperature_2m?: (number | null)[];
  precipitation?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
}
interface OmForecast {
  latitude: number;
  longitude: number;
  hourly?: OmHourly;
}
interface OmFloodDaily {
  time: string[];
  river_discharge?: (number | null)[];
}
interface OmFlood {
  daily?: OmFloodDaily;
}

/**
 * Coords per GET request. Open-Meteo accepts multiple coordinates, but its
 * nginx caps the request URI (~8 KB) — each lat/lng pair costs ~18 chars, so a
 * large batch overflows it and the gateway returns 414. 100 keeps the URL well
 * under the limit; overridable via OPEN_METEO_MAX_COORDS.
 */
const DEFAULT_MAX_COORDS_PER_REQUEST = 100;

/**
 * PRIMARY forecast source (keyless). Pulls the hourly weather time-series from
 * the Forecast API and merges river level from the Flood API (river_discharge),
 * batching up to 1,000 coordinates per request as the design specifies. River
 * data is best-effort: if the Flood API fails, weather still ingests with null
 * river levels rather than failing the whole refresh.
 */
@Injectable()
export class OpenMeteoProvider implements ForecastProvider {
  readonly code = WeatherSource.OPEN_METEO;
  readonly requiresKey = false;

  private readonly logger = new Logger(OpenMeteoProvider.name);
  private readonly forecastBase: string;
  private readonly floodBase: string;
  private readonly maxCoordsPerRequest: number;

  constructor(private readonly config: ConfigService) {
    this.forecastBase =
      this.config.get<string>('OPEN_METEO_FORECAST_URL') ??
      'https://api.open-meteo.com/v1/forecast';
    this.floodBase =
      this.config.get<string>('OPEN_METEO_FLOOD_URL') ??
      'https://flood-api.open-meteo.com/v1/flood';
    const parsed = parseInt(
      this.config.get<string>('OPEN_METEO_MAX_COORDS') ?? '',
      10,
    );
    this.maxCoordsPerRequest =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_MAX_COORDS_PER_REQUEST;
  }

  isConfigured(): boolean {
    return true; // keyless
  }

  private httpOpts(): HttpOptions {
    return {
      timeoutMs: parseInt(
        this.config.get<string>('WEATHER_HTTP_TIMEOUT_MS') ?? '10000',
        10,
      ),
      retries: parseInt(
        this.config.get<string>('WEATHER_HTTP_RETRIES') ?? '2',
        10,
      ),
    };
  }

  async ping(timeoutMs?: number): Promise<number> {
    return pingUrl(
      `${this.forecastBase}?latitude=21.03&longitude=105.85&hourly=temperature_2m&forecast_days=1`,
      { timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs, retries: 0 },
    );
  }

  async fetchForecast(
    targets: ForecastTarget[],
    days: number,
  ): Promise<ForecastResult> {
    const series: TargetForecast[] = [];
    let rawSample: unknown = null;

    for (let i = 0; i < targets.length; i += this.maxCoordsPerRequest) {
      const chunk = targets.slice(i, i + this.maxCoordsPerRequest);
      const lats = chunk.map((t) => t.latitude).join(',');
      const lngs = chunk.map((t) => t.longitude).join(',');

      const forecastUrl =
        `${this.forecastBase}?latitude=${lats}&longitude=${lngs}` +
        `&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m` +
        `&forecast_days=${days}&timezone=UTC`;
      const fcRaw = await fetchJson<OmForecast | OmForecast[]>(
        forecastUrl,
        this.httpOpts(),
      );
      const forecasts = Array.isArray(fcRaw) ? fcRaw : [fcRaw];
      if (rawSample === null) rawSample = forecasts[0] ?? null;

      // River level is best-effort — don't fail the chunk if Flood API is down.
      let floods: OmFlood[] = [];
      try {
        const floodUrl =
          `${this.floodBase}?latitude=${lats}&longitude=${lngs}` +
          `&daily=river_discharge&forecast_days=${days}&timezone=UTC`;
        const flRaw = await fetchJson<OmFlood | OmFlood[]>(
          floodUrl,
          this.httpOpts(),
        );
        floods = Array.isArray(flRaw) ? flRaw : [flRaw];
      } catch (err) {
        this.logger.warn(
          `Flood API failed for chunk @${i}; river levels null: ${(err as Error).message}`,
        );
      }

      chunk.forEach((target, idx) => {
        const riverByDate = this.indexRiverByDate(floods[idx]?.daily);
        series.push({
          target,
          points: this.toPoints(forecasts[idx]?.hourly, riverByDate),
        });
      });
    }

    return { series, raw: rawSample };
  }

  /** Map a Flood daily series to { 'YYYY-MM-DD' -> discharge }. */
  private indexRiverByDate(daily?: OmFloodDaily): Map<string, number | null> {
    const map = new Map<string, number | null>();
    if (!daily?.time) return map;
    daily.time.forEach((d, i) => {
      map.set(d, daily.river_discharge?.[i] ?? null);
    });
    return map;
  }

  private toPoints(
    hourly: OmHourly | undefined,
    riverByDate: Map<string, number | null>,
  ): ForecastPoint[] {
    if (!hourly?.time) return [];
    return hourly.time.map((iso, i) => ({
      forecastTime: new Date(iso),
      temperature: hourly.temperature_2m?.[i] ?? null,
      rainfall: hourly.precipitation?.[i] ?? null,
      windSpeed: hourly.wind_speed_10m?.[i] ?? null,
      windDirection: hourly.wind_direction_10m?.[i] ?? null,
      riverWaterLevel: riverByDate.get(iso.slice(0, 10)) ?? null,
    }));
  }
}
