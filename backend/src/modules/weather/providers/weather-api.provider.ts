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
import { fetchJson, HttpOptions, pingUrl } from './http.util';

interface WapiHour {
  time_epoch: number;
  temp_c?: number;
  precip_mm?: number;
  wind_kph?: number;
  wind_degree?: number;
}
interface WapiDay {
  hour?: WapiHour[];
}
interface WapiForecast {
  forecast?: { forecastday?: WapiDay[] };
}

/** WeatherAPI free plan caps the forecast at 3 days. */
const MAX_DAYS = 3;

/**
 * Fallback #2 (requires API key). Queried per coordinate; only runs when both
 * Open-Meteo and OWM are unavailable. Provides no river level.
 */
@Injectable()
export class WeatherApiProvider implements ForecastProvider {
  readonly code = WeatherSource.WEATHER_API;
  readonly requiresKey = true;

  private readonly base: string;
  private readonly apiKey?: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('WEATHERAPI_FORECAST_URL') ??
      'https://api.weatherapi.com/v1/forecast.json';
    this.apiKey = this.config.get<string>('WEATHERAPI_KEY') || undefined;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
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
      `${this.base}?key=${this.apiKey ?? ''}&q=21.03,105.85&days=1`,
      { timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs, retries: 0 },
    );
  }

  async fetchForecast(
    targets: ForecastTarget[],
    days: number,
  ): Promise<ForecastResult> {
    const series: TargetForecast[] = [];
    let rawSample: unknown = null;
    const reqDays = Math.min(days, MAX_DAYS);

    for (const target of targets) {
      const url =
        `${this.base}?key=${this.apiKey}` +
        `&q=${target.latitude},${target.longitude}&days=${reqDays}`;
      const data = await fetchJson<WapiForecast>(url, this.httpOpts());
      if (rawSample === null) rawSample = data;
      series.push({ target, points: this.toPoints(data) });
    }

    return { series, raw: rawSample };
  }

  private toPoints(data: WapiForecast): ForecastPoint[] {
    const hours = (data.forecast?.forecastday ?? []).flatMap(
      (d) => d.hour ?? [],
    );
    return hours.map((h) => ({
      forecastTime: new Date(h.time_epoch * 1000),
      temperature: h.temp_c ?? null,
      rainfall: h.precip_mm ?? null,
      windSpeed: h.wind_kph ?? null,
      windDirection: h.wind_degree ?? null,
      riverWaterLevel: null,
    }));
  }
}
