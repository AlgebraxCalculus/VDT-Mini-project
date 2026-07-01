import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RiskStatus } from '../stations/entities/station.entity';
import { GeoMultiPolygon, GeoPolygon } from '../../common/types/geometry.types';
import { MapStationsDto } from './dto/map-stations.dto';
import { MapEventsDto } from './dto/map-events.dto';
import { MapWeatherDto, WeatherLayer } from './dto/map-weather.dto';
import { MapSearchDto } from './dto/map-search.dto';

/**
 * Zoom below which {@link MapService.getStations} clusters. The country view
 * (~zoom 6 for Vietnam) clusters; panning in (zoom 8+) reveals individual,
 * clickable station dots. Matches the design's "gộp marker khi zoom-out".
 * Kept low enough that users reach clickable dots quickly (the map's cluster
 * click flies to ≥ 9, always above this threshold).
 */
const CLUSTER_ZOOM_THRESHOLD = 8;

/** Horizon (days) for the peak-risk lookup attached to map stations. */
const RISK_WINDOW_DAYS = 7;

/**
 * A station point for the map: a Group C station shape (province nested, geom
 * dropped) enriched with its peak risk over the window + a light forecast
 * snapshot. Deliberately mirrors the frontend `Station` type so the existing map
 * rendering consumes it without reshaping (thresholds kept as [] for type parity).
 */
export interface MapStation {
  id: number;
  stationCode: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  provinceId: number | null;
  province: { id: number; code: string; name: string } | null;
  riskStatus: RiskStatus | null;
  thresholds: [];
  riskScore: number | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  weather: { temp: number; rain: number; wind: number; humid: number } | null;
}

/** One grid-cell cluster returned when the map is zoomed out. */
export interface MapCluster {
  lng: number;
  lat: number;
  count: number;
  /** Worst risk status among the cell's stations (drives the bubble colour). */
  riskStatus: RiskStatus;
}

export type MapStationsResult =
  | { clustered: false; zoom: number; stations: MapStation[] }
  | { clustered: true; zoom: number; clusters: MapCluster[] };

/** A drawable active event with its affected-area footprint as GeoJSON. */
export interface MapEvent {
  id: string;
  eventCode: string;
  name: string;
  status: string;
  disasterTypeCode: string | null;
  startTime: string;
  provinceCount: number;
  stationCount: number;
  affectedArea: GeoPolygon | GeoMultiPolygon | null;
}

/** One weather-overlay sample (API 29). value unit depends on the layer. */
export interface WeatherOverlayPoint {
  lat: number;
  lng: number;
  value: number;
}

export interface WeatherOverlayResult {
  layer: WeatherLayer;
  snapshotId: string | null;
  points: WeatherOverlayPoint[];
}

/**
 * Group E — Map / GIS by viewport BBOX (APIs 27–30). Every query is read-only and
 * spatial: stations/events/weather are filtered to the on-screen rectangle via the
 * GIST index (ST_MakeEnvelope/ST_Contains), so payloads stay viewport-scoped. All
 * geometry work is raw PostGIS through the injected DataSource (never round-tripped
 * through the ORM), matching the project's spatial convention.
 */
@Injectable()
export class MapService {
  constructor(private readonly dataSource: DataSource) {}

  // ---------------------------------------------------------------------------
  // API 27 — GET /map/stations (stations + risk, clustered when zoomed out).
  // ---------------------------------------------------------------------------

  async getStations(dto: MapStationsDto): Promise<MapStationsResult> {
    const { minLng, minLat, maxLng, maxLat, zoom, riskStatus, limit } = dto;

    if (zoom < CLUSTER_ZOOM_THRESHOLD) {
      const clusters = await this.clusterStations(
        minLng,
        minLat,
        maxLng,
        maxLat,
        zoom,
        riskStatus,
      );
      return { clustered: true, zoom, clusters };
    }

    const stations = await this.queryStations({
      minLng,
      minLat,
      maxLng,
      maxLat,
      riskStatus,
      limit,
    });
    return { clustered: false, zoom, stations };
  }

  /**
   * Aggregate in-view stations into grid cells. The cell size scales with zoom so
   * a cell stays a stable fraction of the screen. No per-station LATERAL here
   * (kept cheap): the cluster colour is the worst cached `risk_status` in the cell.
   */
  private async clusterStations(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    zoom: number,
    riskStatus?: RiskStatus,
  ): Promise<MapCluster[]> {
    // 3 cells per slippy tile at this zoom → a few hundred metres … tens of km.
    const cell = 360 / Math.pow(2, zoom) / 3;
    const rows = await this.dataSource.query<
      { lng: number; lat: number; count: number; worst_rank: number }[]
    >(
      `SELECT ST_X(ST_Centroid(ST_Collect(sub.geom)))::float8 AS lng,
              ST_Y(ST_Centroid(ST_Collect(sub.geom)))::float8 AS lat,
              COUNT(*)::int AS count,
              MAX(sub.rank)::int AS worst_rank
         FROM (
           SELECT s.geom,
                  CASE s.risk_status
                    WHEN 'DANGER'  THEN 3
                    WHEN 'WARNING' THEN 2
                    WHEN 'WATCH'   THEN 1
                    ELSE 0 END AS rank
             FROM stations s
            WHERE s.is_deleted = false
              AND s.geom IS NOT NULL
              AND ST_Contains(ST_MakeEnvelope($1, $2, $3, $4, 4326), s.geom)
              ${riskStatus ? 'AND s.risk_status = $6' : ''}
         ) sub
        GROUP BY ST_SnapToGrid(sub.geom, $5)`,
      riskStatus
        ? [minLng, minLat, maxLng, maxLat, cell, riskStatus]
        : [minLng, minLat, maxLng, maxLat, cell],
    );

    return rows.map((r) => ({
      lng: Number(r.lng),
      lat: Number(r.lat),
      count: r.count,
      riskStatus: rankToStatus(r.worst_rank),
    }));
  }

  // ---------------------------------------------------------------------------
  // API 30 — GET /map/stations/search (free-text + risk filter in viewport).
  // ---------------------------------------------------------------------------

  getSearch(dto: MapSearchDto): Promise<MapStation[]> {
    return this.queryStations({
      minLng: dto.minLng,
      minLat: dto.minLat,
      maxLng: dto.maxLng,
      maxLat: dto.maxLat,
      riskStatus: dto.riskStatus,
      q: dto.q,
      limit: dto.limit,
    });
  }

  /**
   * Shared station query backing API 27 (individual mode) and API 30 (search):
   * in-view stations enriched with peak risk over the window + the nearest forecast
   * row of the latest snapshot. Free-text `q` spans name/province/code.
   *
   * Performance: the bbox-filtered stations are capped to `limit` FIRST (in the
   * `inview` CTE, ordered by the cheap cached `risk_status`), so the risk/forecast
   * enrichment runs only over the rows actually returned — not every station in a
   * wide viewport. Enrichment is two DISTINCT ON CTEs hash-joined to `inview`, not a
   * per-row LATERAL (the LATERAL form re-scanned the 10M-row forecast table per
   * station and was multi-second; see the same CTE-over-LATERAL note in Reports).
   */
  private async queryStations(opts: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    riskStatus?: RiskStatus;
    q?: string;
    limit: number;
  }): Promise<MapStation[]> {
    const { from, to } = this.riskWindow();
    const snapshotId = await this.latestForecastSnapshotId();

    // Positional params: $1-4 bbox, $5 from, $6 to, $7 snapshotId, $8 limit,
    // then optional $9 riskStatus / $10 q-term appended in order.
    const params: unknown[] = [
      opts.minLng,
      opts.minLat,
      opts.maxLng,
      opts.maxLat,
      from,
      to,
      snapshotId,
      opts.limit,
    ];
    let filters = '';
    if (opts.riskStatus) {
      params.push(opts.riskStatus);
      filters += ` AND s.risk_status = $${params.length}`;
    }
    if (opts.q) {
      params.push(`%${opts.q}%`);
      const i = params.length;
      filters += ` AND (s.name ILIKE $${i} OR p.name ILIKE $${i} OR s.station_code ILIKE $${i})`;
    }

    const riskRank = `CASE %ALIAS%.risk_status
                        WHEN 'DANGER'  THEN 3
                        WHEN 'WARNING' THEN 2
                        WHEN 'WATCH'   THEN 1
                        ELSE 0 END`;

    const rows = await this.dataSource.query<RawMapStation[]>(
      `WITH inview AS (
         SELECT s.id, s.station_code, s.name, s.latitude, s.longitude, s.elevation,
                s.province_id, s.risk_status,
                p.code AS province_code, p.name AS province_name
           FROM stations s
           LEFT JOIN provinces p ON p.id = s.province_id
          WHERE s.is_deleted = false
            AND s.geom IS NOT NULL
            AND ST_Contains(ST_MakeEnvelope($1, $2, $3, $4, 4326), s.geom)
            ${filters}
          ORDER BY ${riskRank.replace('%ALIAS%', 's')} DESC
          LIMIT $8
       ),
       rk AS (
         SELECT DISTINCT ON (a.station_id) a.station_id, a.risk_score, a.severity
           FROM station_risk_assessments a
           JOIN inview iv ON iv.id = a.station_id
          WHERE a.forecast_date BETWEEN $5 AND $6
          ORDER BY a.station_id, a.risk_score DESC NULLS LAST
       ),
       fc AS (
         SELECT DISTINCT ON (wf.station_id)
                wf.station_id, wf.temperature, wf.rainfall, wf.wind_speed
           FROM weather_forecasts wf
           JOIN inview iv ON iv.id = wf.station_id
          WHERE $7::bigint IS NOT NULL AND wf.snapshot_id = $7::bigint
          ORDER BY wf.station_id, wf.forecast_time ASC
       )
       SELECT iv.id,
              iv.station_code  AS "stationCode",
              iv.name,
              iv.latitude,
              iv.longitude,
              iv.elevation,
              iv.province_id   AS "provinceId",
              iv.risk_status   AS "riskStatus",
              iv.province_code AS "provinceCode",
              iv.province_name AS "provinceName",
              rk.risk_score    AS "riskScore",
              rk.severity,
              fc.temperature,
              fc.rainfall,
              fc.wind_speed    AS "windSpeed"
         FROM inview iv
         LEFT JOIN rk ON rk.station_id = iv.id
         LEFT JOIN fc ON fc.station_id = iv.id
        ORDER BY ${riskRank.replace('%ALIAS%', 'iv')} DESC,
                 rk.risk_score DESC NULLS LAST`,
      params,
    );

    return rows.map(toMapStation);
  }

  // ---------------------------------------------------------------------------
  // API 28 — GET /map/events (active events + affected polygon in viewport).
  // ---------------------------------------------------------------------------

  /**
   * Events whose scope intersects the viewport, with a drawable footprint: the
   * union of the event's `event_provinces.affected_area` polygons (frozen at
   * assignment), simplified for transport. For province-only scopes (affected_area
   * NULL) it falls back to the union of the in-scope province boundaries so the
   * map still has something to draw.
   */
  async getEvents(dto: MapEventsDto): Promise<MapEvent[]> {
    const { minLng, minLat, maxLng, maxLat, status } = dto;
    const rows = await this.dataSource.query<
      {
        id: string;
        eventCode: string;
        name: string;
        status: string;
        typeCode: string | null;
        startTime: Date;
        provinceCount: number;
        stationCount: number;
        area: string | null;
      }[]
    >(
      `SELECT e.id,
              e.event_code AS "eventCode",
              e.name,
              e.status,
              dt.code      AS "typeCode",
              e.start_time AS "startTime",
              (SELECT COUNT(*)::int FROM event_provinces ep WHERE ep.event_id = e.id)
                AS "provinceCount",
              (SELECT COUNT(*)::int
                 FROM event_stations es
                 JOIN stations s ON s.id = es.station_id AND s.is_deleted = false
                WHERE es.event_id = e.id) AS "stationCount",
              ST_AsGeoJSON(
                ST_Simplify(
                  COALESCE(
                    ST_UnaryUnion(ST_Collect(ep.affected_area)),
                    ST_UnaryUnion(ST_Collect(prov.boundary))
                  ),
                  0.01
                )
              ) AS area
         FROM disaster_events e
         JOIN disaster_types dt ON dt.id = e.disaster_type_id
         LEFT JOIN event_provinces ep ON ep.event_id = e.id
         LEFT JOIN provinces prov ON prov.id = ep.province_id
        WHERE e.status = $5
          AND (
            EXISTS (
              SELECT 1 FROM event_provinces ep2
               WHERE ep2.event_id = e.id
                 AND ep2.affected_area IS NOT NULL
                 AND ST_Intersects(
                       ep2.affected_area,
                       ST_MakeEnvelope($1, $2, $3, $4, 4326))
            )
            OR EXISTS (
              SELECT 1 FROM event_stations es2
               JOIN stations s2 ON s2.id = es2.station_id
               WHERE es2.event_id = e.id
                 AND s2.geom IS NOT NULL
                 AND ST_Contains(
                       ST_MakeEnvelope($1, $2, $3, $4, 4326), s2.geom)
            )
          )
        GROUP BY e.id, dt.code
        ORDER BY e.start_time DESC`,
      [minLng, minLat, maxLng, maxLat, status],
    );

    return rows.map((r) => ({
      id: String(r.id),
      eventCode: r.eventCode,
      name: r.name,
      status: r.status,
      disasterTypeCode: r.typeCode,
      startTime:
        r.startTime instanceof Date
          ? r.startTime.toISOString()
          : String(r.startTime),
      provinceCount: r.provinceCount,
      stationCount: r.stationCount,
      affectedArea: r.area
        ? (JSON.parse(r.area) as GeoPolygon | GeoMultiPolygon)
        : null,
    }));
  }

  // ---------------------------------------------------------------------------
  // API 29 — GET /map/weather (forecast field overlay in viewport).
  // ---------------------------------------------------------------------------

  async getWeatherOverlay(dto: MapWeatherDto): Promise<WeatherOverlayResult> {
    const { minLng, minLat, maxLng, maxLat, layer } = dto;
    const snapshotId = await this.latestForecastSnapshotId();
    if (!snapshotId) return { layer, snapshotId: null, points: [] };

    const field = WEATHER_FIELD[layer];
    const rows = await this.dataSource.query<
      { lat: string | null; lng: string | null; value: string | null }[]
    >(
      `SELECT s.latitude AS lat, s.longitude AS lng, w.value
         FROM stations s
         JOIN LATERAL (
           SELECT wf.${field} AS value
             FROM weather_forecasts wf
            WHERE wf.station_id = s.id
              AND wf.snapshot_id = $5
              AND wf.${field} IS NOT NULL
            ORDER BY wf.forecast_time ASC
            LIMIT 1
         ) w ON true
        WHERE s.is_deleted = false
          AND s.geom IS NOT NULL
          AND ST_Contains(ST_MakeEnvelope($1, $2, $3, $4, 4326), s.geom)
        ORDER BY w.value DESC
        LIMIT 1500`,
      [minLng, minLat, maxLng, maxLat, snapshotId],
    );

    const points: WeatherOverlayPoint[] = rows
      .filter((r) => r.lat != null && r.lng != null && r.value != null)
      .map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        value: Number(r.value),
      }));

    return { layer, snapshotId, points };
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

  /** Latest SUCCESS forecast snapshot (excludes the disaster sources). */
  private async latestForecastSnapshotId(): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM weather_snapshots
        WHERE status = 'SUCCESS'
          AND source_code NOT IN ('GDACS','EONET','ReliefWeb')
        ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  /** [today, today+7] as YYYY-MM-DD — the window the peak-risk lookup scans. */
  private riskWindow(): { from: string; to: string } {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + RISK_WINDOW_DAYS);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(today), to: fmt(end) };
  }
}

/** weather_forecasts column for each overlay layer. */
const WEATHER_FIELD: Record<WeatherLayer, string> = {
  [WeatherLayer.RAIN]: 'rainfall',
  [WeatherLayer.WIND]: 'wind_speed',
  [WeatherLayer.TEMP]: 'temperature',
};

interface RawMapStation {
  id: number;
  stationCode: string;
  name: string;
  latitude: string | null;
  longitude: string | null;
  elevation: string | null;
  provinceId: number | null;
  riskStatus: string | null;
  provinceCode: string | null;
  provinceName: string | null;
  riskScore: string | null;
  severity: string | null;
  temperature: string | null;
  rainfall: string | null;
  windSpeed: string | null;
}

function toMapStation(r: RawMapStation): MapStation {
  const temp = numOrNull(r.temperature);
  const rain = numOrNull(r.rainfall);
  const wind = numOrNull(r.windSpeed);
  const hasWeather = temp != null || rain != null || wind != null;
  return {
    id: r.id,
    stationCode: r.stationCode,
    name: r.name,
    latitude: numOrNull(r.latitude),
    longitude: numOrNull(r.longitude),
    elevation: numOrNull(r.elevation),
    provinceId: r.provinceId,
    province:
      r.provinceId != null
        ? {
            id: r.provinceId,
            code: r.provinceCode ?? '',
            name: r.provinceName ?? '',
          }
        : null,
    riskStatus: (r.riskStatus as RiskStatus) ?? null,
    thresholds: [],
    riskScore: numOrNull(r.riskScore),
    severity: (r.severity as 'LOW' | 'MEDIUM' | 'HIGH') ?? null,
    weather: hasWeather
      ? { temp: temp ?? 0, rain: rain ?? 0, wind: wind ?? 0, humid: 0 }
      : null,
  };
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rankToStatus(rank: number): RiskStatus {
  switch (rank) {
    case 3:
      return RiskStatus.DANGER;
    case 2:
      return RiskStatus.WARNING;
    case 1:
      return RiskStatus.WATCH;
    default:
      return RiskStatus.NORMAL;
  }
}
