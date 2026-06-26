import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import { HealthCheckable } from './weather-provider.interface';
import { fetchJson, HttpOptions, pingUrl } from './http.util';

/**
 * Disaster-event source (keyless, UN/EU official). Not a forecast provider —
 * for Group F it only powers healthcheck (API 35) and the GDACS-source snapshot
 * path of manual refresh (the raw events4app payload is stored on the snapshot).
 * Wiring GDACS events into `disaster_events` belongs to Group D, on hold.
 */
@Injectable()
export class GdacsProvider implements HealthCheckable {
  readonly code = WeatherSource.GDACS;
  readonly requiresKey = false;

  private readonly base: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('GDACS_EVENTS_URL') ??
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';
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
    // Unlike the other sources we DO retry the healthcheck ping here: when GDACS
    // is reached via a public read-proxy (allorigins) the proxy→GDACS hop is
    // flaky and intermittently returns Cloudflare 522. A single 522 shouldn't
    // flip the source to DOWN, so give the flaky proxy a couple of chances.
    // 522 (>=500) is retryable in http.util; Cloudflare returns it fast, so the
    // retries mostly cost nothing on the happy path (direct GDACS responds once).
    return pingUrl(this.base, {
      timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs,
      retries: parseInt(
        this.config.get<string>('WEATHER_HTTP_RETRIES') ?? '2',
        10,
      ),
      backoffMs: 500,
    });
  }

  /** Fetch the current event list (raw); stored on the GDACS snapshot. */
  async fetchEvents(): Promise<unknown> {
    return fetchJson<unknown>(this.base, this.httpOpts());
  }
}
