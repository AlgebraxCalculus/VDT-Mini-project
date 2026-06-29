import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';
import { Station } from '../stations/entities/station.entity';
import { WeatherForecast } from './entities/weather-forecast.entity';
import {
  SnapshotTrigger,
  WeatherSnapshot,
  WeatherSource,
} from './entities/weather-snapshot.entity';
import { DISASTER_PROVIDERS, FORECAST_PROVIDERS } from './weather.constants';
import {
  DisasterProvider,
  ForecastProvider,
} from './providers/weather-provider.interface';
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
 * Resolves targets → fetches via the fallback chain Open-Meteo → MET Norway →
 * WeatherAPI → normalizes → persists snapshot + forecasts in one transaction → publishes
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
    @Inject(DISASTER_PROVIDERS)
    private readonly disasterProviders: DisasterProvider[],
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
  // Forecast path (Open-Meteo → MET Norway → WeatherAPI)
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
        // Keep river data alive between daily GloFAS runs (see carryForwardRiver).
        await this.carryForwardRiver(manager, snapshot.id);
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
  // Disaster path — fallback chain GDACS → ReliefWeb → EONET. Stores the raw
  // events on a snapshot tagged with whichever source succeeded.
  // ---------------------------------------------------------------------------

  private async ingestDisaster(
    opts: IngestOptions,
  ): Promise<{ snapshotId: string }> {
    const snapshot = await this.snapshotsRepo.save(
      this.snapshotsRepo.create({
        sourceCode: WeatherSource.GDACS, // updated to the source that succeeds
        triggerType: opts.trigger,
        triggeredBy: opts.triggeredBy,
        status: 'PENDING',
      }),
    );
    try {
      const { raw, source } = await this.fetchDisastersWithFallback();
      await this.snapshotsRepo.update(snapshot.id, {
        sourceCode: source,
        status: 'SUCCESS',
        rawPayload: this.trimRaw(raw),
      });
      await this.eventBus.publish(EVENT_CHANNELS.WEATHER_SNAPSHOT, {
        snapshotId: snapshot.id,
        sourceCode: source,
      });
      this.logger.log(`Disaster snapshot ${snapshot.id} ingested via ${source}`);
      return { snapshotId: snapshot.id };
    } catch (err) {
      await this.snapshotsRepo.update(snapshot.id, { status: 'FAILED' });
      throw err;
    }
  }

  /** Try each configured disaster source in priority order; throw if all fail. */
  private async fetchDisastersWithFallback(): Promise<{
    raw: unknown;
    source: WeatherSource;
  }> {
    const errors: string[] = [];
    for (const provider of this.disasterProviders) {
      if (!provider.isConfigured()) {
        this.logger.warn(`Skipping ${provider.code} (not configured)`);
        continue;
      }
      try {
        const raw = await provider.fetchEvents();
        return { raw, source: provider.code };
      } catch (err) {
        const msg = `${provider.code}: ${(err as Error).message}`;
        this.logger.warn(`Disaster source failed, trying next — ${msg}`);
        errors.push(msg);
      }
    }
    throw new Error(`All disaster sources failed [${errors.join(' | ')}]`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Carry the most recent river_water_level into this fresh forecast snapshot.
   *
   * GloFAS runs once/day and only enriches whatever snapshot was latest at its run
   * time; every hourly forecast ingest in between creates a snapshot whose river
   * column is NULL (forecast providers don't supply river). Left as-is that would
   * collapse the Risk Engine's V index — and thus severity — back to LOW until the
   * next GloFAS run. To avoid that *without a schema change*, copy the river stage
   * from the most recent prior forecast snapshot that has river data, matched per
   * station + calendar day. Runs inside the ingest transaction so the snapshot is
   * never published river-less when carry-forward data exists; the next GloFAS run
   * overwrites these carried values with fresh discharge-derived stages.
   *
   * No-op (cheap single-row probe) when no prior river data exists yet. Province
   * rows (station_id NULL) are not carried — GloFAS only enriches station rows.
   */
  private async carryForwardRiver(
    manager: EntityManager,
    snapshotId: string,
  ): Promise<void> {
    // Most recent prior forecast snapshot that actually holds river data.
    const src = await manager.query<{ snapshot_id: string }[]>(
      `SELECT prev.snapshot_id
         FROM weather_forecasts prev
         JOIN weather_snapshots ws ON ws.id = prev.snapshot_id
        WHERE prev.river_water_level IS NOT NULL
          AND ws.id < $1
          AND ws.source_code NOT IN ('GDACS','EONET','ReliefWeb','GloFAS')
        ORDER BY ws.id DESC
        LIMIT 1`,
      [snapshotId],
    );
    const sourceId = src[0]?.snapshot_id;
    if (!sourceId) return; // no prior river data yet — nothing to carry

    await manager.query(
      `UPDATE weather_forecasts cur
          SET river_water_level = prev.river_water_level
         FROM weather_forecasts prev
        WHERE prev.snapshot_id = $1
          AND cur.snapshot_id = $2
          AND cur.station_id = prev.station_id
          AND (cur.forecast_time)::date = (prev.forecast_time)::date
          AND cur.river_water_level IS NULL`,
      [sourceId, snapshotId],
    );
    this.logger.log(
      `Snapshot ${snapshotId}: carried river_water_level forward from snapshot ${sourceId}`,
    );
  }

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
