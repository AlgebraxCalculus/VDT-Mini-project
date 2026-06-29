import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import { DisasterProvider } from './weather-provider.interface';
import { fetchJson, HttpOptions } from './http.util';

/**
 * Disaster-event source — ReliefWeb (UN OCHA). A directly-reachable replacement
 * for GDACS/EONET, both of which are network-blocked from some hosts. Not a
 * forecast provider: for Group F it powers healthcheck (API 35) and the
 * disaster-source snapshot path (raw payload stored on the snapshot); wiring
 * events into `disaster_events` belongs to Group D, on hold.
 *
 * ReliefWeb v2 requires an *approved* `appname` (free, requested at
 * apidoc.reliefweb.int); without it every call returns 403. The provider is
 * therefore treated like a keyed source — `isConfigured()` is false (skipped)
 * until RELIEFWEB_APPNAME is set.
 */
@Injectable()
export class ReliefWebProvider implements DisasterProvider {
  readonly code = WeatherSource.RELIEFWEB;
  readonly requiresKey = true; // the approved appname acts as the key

  private readonly base: string;
  private readonly appname?: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('RELIEFWEB_URL') ??
      'https://api.reliefweb.int/v2/disasters';
    this.appname = this.config.get<string>('RELIEFWEB_APPNAME') || undefined;
  }

  isConfigured(): boolean {
    return !!this.appname;
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
    const started = Date.now();
    await fetchJson<unknown>(
      `${this.base}?appname=${encodeURIComponent(this.appname ?? '')}&limit=1`,
      { timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs, retries: 0 },
    );
    return Date.now() - started;
  }

  /**
   * Fetch the latest disaster events for Vietnam (raw); stored on the snapshot.
   * Filtered to primary_country VNM, newest first.
   */
  async fetchEvents(): Promise<unknown> {
    const params = new URLSearchParams({
      appname: this.appname ?? '',
      limit: '20',
      'sort[]': 'date.created:desc',
      'filter[field]': 'primary_country.iso3',
      'filter[value]': 'VNM',
    });
    const fields = ['name', 'status', 'date', 'primary_country.name', 'primary_type.name'];
    for (const f of fields) params.append('fields[include][]', f);
    return fetchJson<unknown>(`${this.base}?${params.toString()}`, this.httpOpts());
  }
}
