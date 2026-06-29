import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import {
  ForecastPoint,
  ForecastResult,
  ForecastTarget,
  TargetForecast,
} from '../types/normalized-forecast';
import { ForecastProvider } from './weather-provider.interface';
import { fetchJson, HttpOptions } from './http.util';

interface MetInstantDetails {
  air_temperature?: number;
  wind_speed?: number;
  wind_from_direction?: number;
}
interface MetPeriodDetails {
  precipitation_amount?: number;
}
interface MetTimeseries {
  time: string;
  data: {
    instant?: { details?: MetInstantDetails };
    next_1_hours?: { details?: MetPeriodDetails };
    next_6_hours?: { details?: MetPeriodDetails };
  };
}
interface MetForecast {
  properties?: { timeseries?: MetTimeseries[] };
}

/**
 * Fallback forecast source — MET Norway (Yr) Locationforecast. Keyless and
 * reachable from networks that block the other providers' hosts; sits at the end
 * of the fallback chain so it catches when Open-Meteo / OWM / WeatherAPI are all
 * rate-limited or down. Queried per coordinate (no batching) and provides no
 * river level. MET's terms require an identifying User-Agent with a contact —
 * override via MET_NORWAY_USER_AGENT.
 */
@Injectable()
export class MetNorwayProvider implements ForecastProvider {
  readonly code = WeatherSource.MET_NORWAY;
  readonly requiresKey = false;

  private readonly base: string;
  private readonly userAgent: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('MET_NORWAY_URL') ??
      'https://api.met.no/weatherapi/locationforecast/2.0/compact';
    this.userAgent =
      this.config.get<string>('MET_NORWAY_USER_AGENT') ??
      'vtnet-flood-warning/1.0 (contact: admin@hsms.vn)';
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

  /** MET requires the User-Agent header; the default fetch UA is rejected (403). */
  private headers(): RequestInit {
    return { headers: { 'User-Agent': this.userAgent } };
  }

  async ping(timeoutMs?: number): Promise<number> {
    const started = Date.now();
    await fetchJson<MetForecast>(
      this.url(21.03, 105.85),
      { timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs, retries: 0 },
      this.headers(),
    );
    return Date.now() - started;
  }

  async fetchForecast(
    targets: ForecastTarget[],
    days: number,
  ): Promise<ForecastResult> {
    const series: TargetForecast[] = [];
    let rawSample: unknown = null;
    const horizon = Date.now() + days * 24 * 60 * 60 * 1000;

    for (const target of targets) {
      const data = await fetchJson<MetForecast>(
        this.url(target.latitude, target.longitude),
        this.httpOpts(),
        this.headers(),
      );
      if (rawSample === null) rawSample = data;
      series.push({ target, points: this.toPoints(data, horizon) });
    }

    return { series, raw: rawSample };
  }

  /** MET caps coordinate precision at 4 decimals; more returns a 400. */
  private url(lat: number, lon: number): string {
    return `${this.base}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  }

  private toPoints(data: MetForecast, horizonMs: number): ForecastPoint[] {
    const ts = data.properties?.timeseries ?? [];
    const points: ForecastPoint[] = [];
    for (const entry of ts) {
      const when = new Date(entry.time);
      if (when.getTime() > horizonMs) break; // series is chronological
      const instant = entry.data.instant?.details ?? {};
      const rain =
        entry.data.next_1_hours?.details?.precipitation_amount ??
        entry.data.next_6_hours?.details?.precipitation_amount ??
        null;
      points.push({
        forecastTime: when,
        temperature: instant.air_temperature ?? null,
        rainfall: rain,
        windSpeed: instant.wind_speed ?? null,
        windDirection: instant.wind_from_direction ?? null,
        riverWaterLevel: null,
      });
    }
    return points;
  }
}
