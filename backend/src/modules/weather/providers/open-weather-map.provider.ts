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

interface OwmListItem {
  dt: number;
  main?: { temp?: number };
  wind?: { speed?: number; deg?: number };
  rain?: { '3h'?: number };
}
interface OwmForecast {
  list?: OwmListItem[];
}

/**
 * Fallback #1 (requires API key). OWM's free 5-day/3-hour forecast has no
 * batch endpoint, so it's queried per coordinate — acceptable because it only
 * runs when Open-Meteo is fully unavailable. Provides no river level.
 */
@Injectable()
export class OpenWeatherMapProvider implements ForecastProvider {
  readonly code = WeatherSource.OPEN_WEATHER_MAP;
  readonly requiresKey = true;

  private readonly base: string;
  private readonly apiKey?: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('OPENWEATHERMAP_FORECAST_URL') ??
      'https://api.openweathermap.org/data/2.5/forecast';
    this.apiKey = this.config.get<string>('OPENWEATHERMAP_API_KEY') || undefined;
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
      `${this.base}?lat=21.03&lon=105.85&appid=${this.apiKey ?? ''}&cnt=1`,
      { timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs, retries: 0 },
    );
  }

  async fetchForecast(
    targets: ForecastTarget[],
    _days: number,
  ): Promise<ForecastResult> {
    const series: TargetForecast[] = [];
    let rawSample: unknown = null;

    for (const target of targets) {
      const url =
        `${this.base}?lat=${target.latitude}&lon=${target.longitude}` +
        `&units=metric&appid=${this.apiKey}`;
      const data = await fetchJson<OwmForecast>(url, this.httpOpts());
      if (rawSample === null) rawSample = data;
      series.push({ target, points: this.toPoints(data.list) });
    }

    return { series, raw: rawSample };
  }

  private toPoints(list?: OwmListItem[]): ForecastPoint[] {
    if (!list) return [];
    return list.map((item) => ({
      forecastTime: new Date(item.dt * 1000),
      temperature: item.main?.temp ?? null,
      rainfall: item.rain?.['3h'] ?? null,
      windSpeed: item.wind?.speed ?? null,
      windDirection: item.wind?.deg ?? null,
      riverWaterLevel: null,
    }));
  }
}
