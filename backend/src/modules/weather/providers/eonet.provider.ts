import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import { DisasterProvider } from './weather-provider.interface';
import { fetchJson, HttpOptions, pingUrl } from './http.util';

/**
 * NASA EONET (Earth Observatory Natural Event Tracker) — keyless, multi-hazard
 * disaster-event source (severe storms, floods, volcanoes, wildfires, sea ice…)
 * with point/polygon geometry. Used as the directly-reachable alternative to
 * GDACS, which is TCP-blocked from some networks. Like GDACS it is *not* a
 * forecast provider: for Group F it only powers healthcheck (API 35) and the
 * disaster-source snapshot path (raw payload stored on the snapshot). Wiring
 * events into `disaster_events` belongs to Group D, on hold.
 */
@Injectable()
export class EonetProvider implements DisasterProvider {
  readonly code = WeatherSource.EONET;
  readonly requiresKey = false;

  private readonly base: string;

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('EONET_EVENTS_URL') ??
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';
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
    // EONET occasionally returns a transient 503 ("high demand"); 503 (>=500) is
    // retryable in http.util, so allow retries on the healthcheck ping to ride
    // over those spikes rather than flipping the source straight to DOWN.
    return pingUrl(this.base, {
      timeoutMs: timeoutMs ?? this.httpOpts().timeoutMs,
      retries: parseInt(
        this.config.get<string>('WEATHER_HTTP_RETRIES') ?? '2',
        10,
      ),
      backoffMs: 500,
    });
  }

  /** Fetch the current open-event list (raw); stored on the EONET snapshot. */
  async fetchEvents(): Promise<unknown> {
    return fetchJson<unknown>(this.base, this.httpOpts());
  }
}
