import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';
import { Station } from '../stations/entities/station.entity';
import { WeatherForecast } from './entities/weather-forecast.entity';
import {
  SnapshotTrigger,
  WeatherSnapshot,
  WeatherSource,
} from './entities/weather-snapshot.entity';
import { FORECAST_PROVIDERS } from './weather.constants';
import { ForecastProvider } from './providers/weather-provider.interface';
import { GdacsProvider } from './providers/gdacs.provider';
import { ForecastResult, ForecastTarget } from './types/normalized-forecast';

/** Input for one ingestion run (manual refresh or scheduled cron). */
export interface IngestOptions {
  trigger: SnapshotTrigger;
  triggeredBy: number | null;
  /** Restrict to these stations; default = all active stations. */
  stationIds?: number[];
  /** Also fetch province-centroid forecasts for these provinces. */
  provinceIds?: number[];
  /** Force a specific source (e.g. GDACS for disaster data). */
  source?: WeatherSource;
}

/** Rows inserted per INSERT to keep statements within parameter limits. */
const FORECAST_CHUNK = 500;

/** Scalar-only insert shape for weather_forecasts (no relations/jsonb). */
interface ForecastInsert {
  snapshotId: string;
  stationId: number | null;
  provinceId: number | null;
  forecastTime: Date;
  temperature: number | null;
  rainfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  riverWaterLevel: number | null;
}

/**
 * Core weather ingestion, shared by the BullMQ processor (manual refresh + cron).
 * Resolves targets → fetches via the fallback chain Open-Meteo → OWM → WeatherAPI
 * → normalizes → persists snapshot + forecasts in one transaction → publishes
 * WEATHER_SNAPSHOT so the (future) Risk Engine recomputes. This is the producer
 * that was missing for the pre-declared WEATHER_SNAPSHOT channel.
 */
@Injectable()
export class WeatherIngestionService {
  private readonly logger = new Logger(WeatherIngestionService.name);
  private readonly forecastDays: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WeatherSnapshot)
    private readonly snapshotsRepo: Repository<WeatherSnapshot>,
    @InjectRepository(Station)
    private readonly stationsRepo: Repository<Station>,
    @Inject(FORECAST_PROVIDERS)
    private readonly forecastProviders: ForecastProvider[],
    private readonly gdacs: GdacsProvider,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {
    this.forecastDays = parseInt(
      this.config.get<string>('WEATHER_FORECAST_DAYS') ?? '7',
      10,
    );
  }

  /** Run one ingestion; returns the created snapshot id. */
  async ingest(opts: IngestOptions): Promise<{ snapshotId: string }> {
    if (opts.source === WeatherSource.GDACS) {
      return this.ingestDisaster(opts);
    }
    return this.ingestForecast(opts);
  }

  // ---------------------------------------------------------------------------
  // Forecast path (Open-Meteo → OWM → WeatherAPI)
  // ---------------------------------------------------------------------------

  private async ingestForecast(
    opts: IngestOptions,
  ): Promise<{ snapshotId: string }> {
    const targets = await this.resolveTargets(opts);

    const snapshot = await this.snapshotsRepo.save(
      this.snapshotsRepo.create({
        sourceCode: WeatherSource.OPEN_METEO, // updated to the source that succeeds
        triggerType: opts.trigger,
        triggeredBy: opts.triggeredBy,
        status: 'PENDING',
      }),
    );

    if (targets.length === 0) {
      this.logger.warn('No forecast targets resolved; marking snapshot EMPTY');
      await this.snapshotsRepo.update(snapshot.id, { status: 'EMPTY' });
      return { snapshotId: snapshot.id };
    }

    try {
      const { result, source } = await this.fetchWithFallback(targets);

      await this.dataSource.transaction(async (manager) => {
        // Plain insert shape (no relation/jsonb) — avoids the QueryDeepPartialEntity
        // pitfall that the entity's `snapshot` relation would otherwise trigger.
        const rows: ForecastInsert[] = [];
        for (const s of result.series) {
          for (const p of s.points) {
            rows.push({
              snapshotId: snapshot.id,
              stationId: s.target.stationId,
              provinceId: s.target.provinceId,
              forecastTime: p.forecastTime,
              temperature: p.temperature,
              rainfall: p.rainfall,
              windSpeed: p.windSpeed,
              windDirection: p.windDirection,
              riverWaterLevel: p.riverWaterLevel,
            });
          }
        }
        for (let i = 0; i < rows.length; i += FORECAST_CHUNK) {
          await manager.insert(WeatherForecast, rows.slice(i, i + FORECAST_CHUNK));
        }
        await manager.update(WeatherSnapshot, snapshot.id, {
          sourceCode: source,
          status: 'SUCCESS',
          rawPayload: this.trimRaw(result.raw),
        });
      });

      await this.eventBus.publish(EVENT_CHANNELS.WEATHER_SNAPSHOT, {
        snapshotId: snapshot.id,
        sourceCode: source,
      });
      this.logger.log(
        `Snapshot ${snapshot.id} ingested via ${source} (${result.series.length} targets)`,
      );
      return { snapshotId: snapshot.id };
    } catch (err) {
      await this.snapshotsRepo.update(snapshot.id, { status: 'FAILED' });
      this.logger.error(
        `Snapshot ${snapshot.id} failed: ${(err as Error).message}`,
      );
      throw err; // let BullMQ retry
    }
  }

  /** Try each configured provider in priority order; throw if all fail. */
  private async fetchWithFallback(
    targets: ForecastTarget[],
  ): Promise<{ result: ForecastResult; source: WeatherSource }> {
    const errors: string[] = [];
    for (const provider of this.forecastProviders) {
      if (!provider.isConfigured()) {
        this.logger.warn(`Skipping ${provider.code} (not configured)`);
        continue;
      }
      try {
        const result = await provider.fetchForecast(targets, this.forecastDays);
        return { result, source: provider.code };
      } catch (err) {
        const msg = `${provider.code}: ${(err as Error).message}`;
        this.logger.warn(`Provider failed, trying next — ${msg}`);
        errors.push(msg);
      }
    }
    throw new Error(`All forecast providers failed [${errors.join(' | ')}]`);
  }

  // ---------------------------------------------------------------------------
  // Disaster path (GDACS) — stores raw events on a GDACS snapshot
  // ---------------------------------------------------------------------------

  private async ingestDisaster(
    opts: IngestOptions,
  ): Promise<{ snapshotId: string }> {
    const snapshot = await this.snapshotsRepo.save(
      this.snapshotsRepo.create({
        sourceCode: WeatherSource.GDACS,
        triggerType: opts.trigger,
        triggeredBy: opts.triggeredBy,
        status: 'PENDING',
      }),
    );
    try {
      const raw = await this.gdacs.fetchEvents();
      await this.snapshotsRepo.update(snapshot.id, {
        status: 'SUCCESS',
        rawPayload: this.trimRaw(raw),
      });
      await this.eventBus.publish(EVENT_CHANNELS.WEATHER_SNAPSHOT, {
        snapshotId: snapshot.id,
        sourceCode: WeatherSource.GDACS,
      });
      return { snapshotId: snapshot.id };
    } catch (err) {
      await this.snapshotsRepo.update(snapshot.id, { status: 'FAILED' });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveTargets(opts: IngestOptions): Promise<ForecastTarget[]> {
    const targets: ForecastTarget[] = [];

    const stations = await this.stationsRepo.find({
      where: {
        isDeleted: false,
        ...(opts.stationIds?.length ? { id: In(opts.stationIds) } : {}),
      },
      select: { id: true, latitude: true, longitude: true },
    });
    for (const s of stations) {
      if (s.latitude != null && s.longitude != null) {
        targets.push({
          stationId: s.id,
          provinceId: null,
          latitude: s.latitude,
          longitude: s.longitude,
        });
      }
    }

    if (opts.provinceIds?.length) {
      // Centroid lives in a geometry column; read lat/lng via PostGIS.
      const rows = await this.dataSource.query<
        { id: number; lat: number | null; lng: number | null }[]
      >(
        `SELECT id, ST_Y(centroid) AS lat, ST_X(centroid) AS lng
         FROM provinces WHERE id = ANY($1)`,
        [opts.provinceIds],
      );
      for (const r of rows) {
        if (r.lat != null && r.lng != null) {
          targets.push({
            stationId: null,
            provinceId: r.id,
            latitude: Number(r.lat),
            longitude: Number(r.lng),
          });
        }
      }
    }

    return targets;
  }

  /**
   * Keep raw_payload bounded — store a sample, not megabytes of time-series.
   * Returns `any`: TypeORM's QueryDeepPartialEntity mishandles the nullable
   * jsonb union, so a precise type can't be assigned into the update payload.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private trimRaw(raw: unknown): any {
    if (raw == null) return null;
    const json = JSON.stringify(raw);
    if (json.length <= 20000) return raw as Record<string, unknown>;
    return { truncated: true, preview: json.slice(0, 20000) };
  }
}
