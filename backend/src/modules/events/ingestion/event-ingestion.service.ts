import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../../event-bus/event-bus.constants';
import { DISASTER_PROVIDERS } from '../../weather/weather.constants';
import { DisasterProvider } from '../../weather/providers/weather-provider.interface';
import { WeatherSource } from '../../weather/entities/weather-snapshot.entity';
import {
  AffectedGeom,
  DEFAULT_RADIUS_CONFIG,
  NormalizedDisaster,
  parseGdacsEvents,
  RadiusConfig,
} from './gdacs.parser';
import { parseEonetEvents } from './eonet.parser';
import { parseReliefWebEvents } from './reliefweb.parser';

/**
 * Source order for event ingestion. EONET outranks ReliefWeb (unlike the weather
 * module's chain) because event scope needs its geometry; ReliefWeb is country-level.
 */
const SOURCE_PRIORITY: WeatherSource[] = [
  WeatherSource.GDACS,
  WeatherSource.EONET,
  WeatherSource.RELIEFWEB,
];

/**
 * `event_code` prefix per source. Doubles as the set of parser-backed sources and
 * the filter that scopes the stale-close sweep to the source that produced the feed.
 */
const SOURCE_PREFIX: Partial<Record<WeatherSource, string>> = {
  [WeatherSource.GDACS]: 'GDACS-',
  [WeatherSource.EONET]: 'EONET-',
  [WeatherSource.RELIEFWEB]: 'RW-',
};

/** All auto-ingested event-code prefixes, for the age-based safety sweep. */
const ALL_AUTO_PREFIXES = Object.values(SOURCE_PREFIX).map((p) => `${p}%`);

/** Priority rank of a source (unknown → last). */
function priorityIndex(code: WeatherSource): number {
  const i = SOURCE_PRIORITY.indexOf(code);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Per-event outcome of one upsert pass. */
type UpsertResult =
  | { skipped: true }
  | { skipped: false; eventId: string; isNew: boolean; addedStationIds: number[] };

export interface IngestSummary {
  created: number;
  updated: number;
  scopedStations: number;
  closed: number;
}

/**
 * Group D — automatic disaster-event tracking (replaces the removed manual API 22).
 * A cron pulls the disaster feed through a GDACS → EONET → ReliefWeb fallback chain,
 * keeps only VN-relevant STORM/FLOOD hazards, and per event: upserts `disaster_events`
 * (deduped by `event_code`), freezes scope into `event_provinces`/`event_stations`
 * via raw PostGIS, and publishes EVENT_SCOPE_ASSIGNED. Events that drop out of the
 * feed go ONGOING → CLOSED (EVENT_CLOSED). Bus publishes are fire-and-forget post-commit.
 * VN-relevance = footprint intersects a known province, which also serves as the scope query.
 */
@Injectable()
export class EventIngestionService {
  private readonly logger = new Logger(EventIngestionService.name);
  private readonly radii: RadiusConfig;

  constructor(
    @Inject(DISASTER_PROVIDERS)
    private readonly providers: DisasterProvider[],
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {
    this.radii = this.loadRadii();
  }

  @Cron(process.env.DISASTER_CRON ?? '20 * * * *', { name: 'disaster-ingest' })
  async scheduledRun(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`disaster ingest failed: ${(err as Error).message}`);
    }
  }

  /** Pull (with fallback) → normalize → upsert + scope → close stale. Returns a summary. */
  async run(): Promise<IngestSummary> {
    const summary: IngestSummary = { created: 0, updated: 0, scopedStations: 0, closed: 0 };

    const fetched = await this.fetchWithFallback();
    // Whole chain down → skip the close-sweep, else it would close every ongoing
    // event just because no source answered.
    if (!fetched) return summary;

    const { raw, source } = fetched;
    const events = this.normalize(source, raw);
    this.logger.log(`${source}: ${events.length} STORM/FLOOD hazard(s) in feed`);

    const seen = new Set<string>();
    for (const ev of events) {
      const res = await this.upsertEvent(ev);
      if (res.skipped) continue;
      seen.add(ev.eventCode);
      if (res.isNew) summary.created++;
      else summary.updated++;

      if (res.addedStationIds.length > 0) {
        summary.scopedStations += res.addedStationIds.length;
        this.publishScope(res.eventId, res.addedStationIds);
      }
    }

    // Close active-source events absent from this feed, plus an age-based safety net
    // for zombies left by a different source (e.g. an EONET event GDACS never lists).
    summary.closed = await this.closeStale(seen, source);
    summary.closed += await this.closeStaleByAge();

    this.logger.log(
      `disaster ingest done via ${source}: +${summary.created} new, ${summary.updated} updated, ` +
        `${summary.scopedStations} stations scoped, ${summary.closed} closed`,
    );
    return summary;
  }

  // --- Source fetch (fallback chain) + normalization ---

  /**
   * Return the first configured, parser-backed source (in priority order) that
   * answers, or null if all failed or are unconfigured.
   */
  private async fetchWithFallback(): Promise<{
    raw: unknown;
    source: WeatherSource;
  } | null> {
    const ordered = [...this.providers].sort(
      (a, b) => priorityIndex(a.code) - priorityIndex(b.code),
    );
    const errors: string[] = [];
    for (const p of ordered) {
      if (!SOURCE_PREFIX[p.code]) continue; // no parser for this source
      if (!p.isConfigured()) {
        this.logger.debug(`skip ${p.code} (not configured)`);
        continue;
      }
      try {
        const raw = await p.fetchEvents();
        return { raw, source: p.code };
      } catch (err) {
        const msg = `${p.code}: ${(err as Error).message}`;
        this.logger.warn(`disaster source failed, trying next — ${msg}`);
        errors.push(msg);
      }
    }
    this.logger.warn(
      errors.length
        ? `all disaster sources failed, skipping run [${errors.join(' | ')}]`
        : 'no disaster source configured, skipping run',
    );
    return null;
  }

  /** Normalize a source's raw payload into {@link NormalizedDisaster}. */
  private normalize(source: WeatherSource, raw: unknown): NormalizedDisaster[] {
    switch (source) {
      case WeatherSource.GDACS:
        return parseGdacsEvents(raw, this.radii);
      case WeatherSource.EONET:
        return parseEonetEvents(raw, this.radii);
      case WeatherSource.RELIEFWEB:
        return parseReliefWebEvents(raw);
      default:
        return [];
    }
  }

  // --- Per-event upsert + scope (one transaction) ---

  private async upsertEvent(ev: NormalizedDisaster): Promise<UpsertResult> {
    const { sql: geomSql, params: geomParams } = affectedSql(ev.geom);
    // event_id placeholder sits right after the geometry params.
    const eIdx = geomParams.length + 1;

    return this.dataSource.transaction(async (m: EntityManager) => {
      // VN-relevance gate + scope predicate: does the footprint touch any province?
      const hit = await m.query(
        `WITH a AS (SELECT ${geomSql} AS geom)
         SELECT 1 FROM provinces p, a WHERE ST_Intersects(p.boundary, a.geom) LIMIT 1`,
        geomParams,
      );
      if (hit.length === 0) return { skipped: true as const };

      const typeId = await this.ensureType(m, ev.typeCode, ev.typeName);
      const description = ev.alertLevel
        ? `Tự động từ GDACS · mức cảnh báo ${ev.alertLevel}`
        : 'Tự động từ GDACS';

      const upserted = await m.query<
        { id: string; status: string; is_new: boolean }[]
      >(
        `INSERT INTO disaster_events
           (event_code, disaster_type_id, name, status, start_time, description)
         VALUES ($1, $2, $3, 'ONGOING', $4, $5)
         ON CONFLICT (event_code)
           DO UPDATE SET name = EXCLUDED.name, updated_at = now()
         RETURNING id, status, (xmax = 0) AS is_new`,
        [ev.eventCode, typeId, ev.name, ev.startTime, description],
      );
      const row = upserted[0];
      const eventId = String(row.id);

      // A reappearing CLOSED event is not re-opened or re-scoped.
      if (row.status === 'CLOSED') {
        return { skipped: false as const, eventId, isNew: false, addedStationIds: [] };
      }

      const scopeParams = [...geomParams, eventId];

      // Affected provinces — store the clipped footprint's bounding polygon
      // (ST_Envelope keeps the column single-Polygon; area>0 drops edge-touches).
      await m.query(
        `WITH a AS (SELECT ${geomSql} AS geom)
         INSERT INTO event_provinces (event_id, province_id, affected_area)
         SELECT $${eIdx}, p.id, ST_Envelope(ST_Intersection(p.boundary, a.geom))
         FROM provinces p, a
         WHERE ST_Intersects(p.boundary, a.geom)
           AND ST_Area(ST_Intersection(p.boundary, a.geom)) > 0
         ON CONFLICT (event_id, province_id)
           DO UPDATE SET affected_area = EXCLUDED.affected_area`,
        scopeParams,
      );

      // Affected stations — scope grows incrementally; only newly-added ids return.
      const added = await m.query<{ station_id: number }[]>(
        `WITH a AS (SELECT ${geomSql} AS geom)
         INSERT INTO event_stations (event_id, station_id)
         SELECT $${eIdx}, s.id
         FROM stations s, a
         WHERE s.is_deleted = false AND ST_Intersects(a.geom, s.geom)
         ON CONFLICT (event_id, station_id) DO NOTHING
         RETURNING station_id`,
        scopeParams,
      );

      return {
        skipped: false as const,
        eventId,
        isNew: row.is_new === true,
        addedStationIds: added.map((r) => Number(r.station_id)),
      };
    });
  }

  /** Resolve (create if missing) a disaster_type id by code. */
  private async ensureType(
    m: EntityManager,
    code: string,
    name: string,
  ): Promise<number> {
    const rows = await m.query<{ id: number }[]>(
      `INSERT INTO disaster_types (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = disaster_types.name
       RETURNING id`,
      [code, name],
    );
    return rows[0].id;
  }

  // --- Lifecycle: close events that left the feed ---

  /**
   * Close ONGOING events from this feed's source that are absent from it. Scoped by
   * the source's event_code prefix so a failover never closes another source's events;
   * skipped when nothing VN-relevant was seen (avoids closing on an empty feed).
   */
  private async closeStale(seen: Set<string>, source: WeatherSource): Promise<number> {
    const prefix = SOURCE_PREFIX[source];
    if (!prefix) return 0;
    if (seen.size === 0) {
      this.logger.debug(`closeStale: no VN-relevant ${source} events this run — skipping sweep`);
      return 0;
    }
    const rows = await this.dataSource.query<{ id: string }[]>(
      `UPDATE disaster_events
          SET status = 'CLOSED', end_time = now(), updated_at = now()
        WHERE event_code LIKE $2
          AND status = 'ONGOING'
          AND event_code <> ALL($1)
        RETURNING id`,
      [[...seen], `${prefix}%`],
    );
    for (const r of rows) this.publishClosed(String(r.id));
    return rows.length;
  }

  /**
   * Safety net: close any ONGOING auto-ingested event not refreshed within
   * `DISASTER_STALE_CLOSE_HOURS` (default 24, 0 disables). Since every upsert bumps
   * updated_at, this only catches zombies a no-longer-active source left behind.
   */
  private async closeStaleByAge(): Promise<number> {
    const hours = parseFloat(this.config.get<string>('DISASTER_STALE_CLOSE_HOURS') ?? '24');
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    const rows = await this.dataSource.query<{ id: string }[]>(
      `UPDATE disaster_events
          SET status = 'CLOSED', end_time = now(), updated_at = now()
        WHERE status = 'ONGOING'
          AND event_code LIKE ANY ($1)
          AND updated_at < now() - make_interval(mins => $2)
        RETURNING id`,
      [ALL_AUTO_PREFIXES, Math.round(hours * 60)],
    );
    for (const r of rows) this.publishClosed(String(r.id));
    if (rows.length) {
      this.logger.log(`closeStaleByAge: closed ${rows.length} zombie event(s) (>${hours}h stale)`);
    }
    return rows.length;
  }

  // --- Bus publishes (fire-and-forget, post-commit) ---

  private publishScope(eventId: string, stationIds: number[]): void {
    void this.eventBus
      .publish(EVENT_CHANNELS.EVENT_SCOPE_ASSIGNED, { eventId, stationIds })
      .catch((err) =>
        this.logger.error(
          `publish scope-assigned failed for event=${eventId}: ${(err as Error).message}`,
        ),
      );
  }

  private publishClosed(eventId: string): void {
    void this.eventBus
      .publish(EVENT_CHANNELS.EVENT_CLOSED, { eventId })
      .catch((err) =>
        this.logger.error(
          `publish event-closed failed for event=${eventId}: ${(err as Error).message}`,
        ),
      );
  }

  private loadRadii(): RadiusConfig {
    const num = (key: string, fallback: number): number => {
      const v = parseFloat(this.config.get<string>(key) ?? '');
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    return {
      storm: num('DISASTER_STORM_RADIUS_DEG', DEFAULT_RADIUS_CONFIG.storm),
      flood: num('DISASTER_FLOOD_RADIUS_DEG', DEFAULT_RADIUS_CONFIG.flood),
      alertMultiplier: DEFAULT_RADIUS_CONFIG.alertMultiplier,
    };
  }
}

/** Build the PostGIS footprint expression using $1..$n; callers append event_id as $(n+1). */
function affectedSql(geom: AffectedGeom): { sql: string; params: unknown[] } {
  switch (geom.kind) {
    case 'point':
      return {
        sql: 'ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)',
        params: [geom.lon, geom.lat, geom.radiusDeg],
      };
    case 'bbox':
      return {
        sql: 'ST_MakeEnvelope($1, $2, $3, $4, 4326)',
        params: [geom.minX, geom.minY, geom.maxX, geom.maxY],
      };
    case 'geojson':
      return {
        sql: 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)',
        params: [geom.geojson],
      };
  }
}
