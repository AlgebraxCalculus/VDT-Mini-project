import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';
import { RealtimeService } from '../realtime/realtime.service';
import {
  RiskSeverity,
  StationRiskAssessment,
} from './entities/station-risk-assessment.entity';
import { AlertHistory } from './entities/alert-history.entity';
import { RiskStatus } from '../stations/entities/station.entity';
import {
  ASSESSMENT_CHUNK,
  RISK_HORIZON_DAYS,
  RISK_RECOMPUTE_LOCK_KEY,
  RISK_RECOMPUTE_LOCK_TTL_MS,
} from './risk.constants';
import {
  alertLevelToRiskStatus,
  assessRisk,
  normalizeWeights,
  rainIndex,
  riverIndex,
  elevationIndex,
  riskStatusRank,
  RiskComponents,
  RiskVerdict,
  RiskWeights,
  ThresholdTier,
  DEFAULT_RISK_WEIGHTS,
} from './risk-formula';

/** Station attributes the engine needs to score it. */
interface StationRow {
  id: number;
  elevation: number | null;
  provinceId: number | null;
  latitude: number | null;
  longitude: number | null;
  riskStatus: RiskStatus | null;
}

/** One day of aggregated forecast for a station (rain summed, river level peaked). */
interface DailyForecast {
  forecastDate: string; // YYYY-MM-DD
  rainfall: number;
  riverWaterLevel: number | null;
}

/** Scalar-only insert shape for station_risk_assessments (no relations). */
interface AssessmentInsert {
  stationId: number;
  eventId: string | null;
  forecastDate: string;
  predictedWaterLevel: number | null;
  thresholdValue: number | null;
  isExceeded: boolean;
  severity: RiskSeverity;
  riskScore: number;
}

/**
 * Scalar-only insert shape for alert_histories. Inserting AlertHistory *instances*
 * trips TypeORM's QueryDeepPartialEntity over the nullable relation columns; a
 * plain object sidesteps it (same pattern as WeatherIngestionService).
 */
interface AlertInsert {
  stationId: number;
  eventId: string | null;
  alertLevel: number;
  triggeredAt: Date;
  actualValue: number | null;
  thresholdValue: number | null;
  reason: string;
  weatherSnapshotId: string;
}

/**
 * Group G — the Risk Engine. This is the consumer the event-driven backbone was
 * waiting for: it subscribes to the four trigger channels, recomputes the
 * pre-computed risk table from the four-layer model in {@link assessRisk}, writes
 * `station_risk_assessments` + `alert_histories`, caches each station's current
 * `risk_status`, and emits RISK_DELTA so the gateway pushes changes to clients.
 *
 * Read APIs (36–39, in {@link RiskService}) only ever query the tables this writes
 * — risk is never computed inline on a request.
 *
 * Single-flight: WEATHER_SNAPSHOT is delivered to every API instance over the bus,
 * so a Redis lock (NX PX) lets exactly one instance run the full recompute. The
 * targeted recomputes (threshold/scope changes) are cheap and run unlocked.
 */
@Injectable()
export class RiskEngineService implements OnModuleInit {
  private readonly logger = new Logger(RiskEngineService.name);
  private readonly weights: RiskWeights;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly eventBus: EventBusService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {
    const rain = parseFloat(
      this.config.get<string>('RISK_WEIGHT_RAIN') ?? '',
    );
    const river = parseFloat(
      this.config.get<string>('RISK_WEIGHT_RIVER') ?? '',
    );
    this.weights = normalizeWeights(
      Number.isFinite(rain) && Number.isFinite(river)
        ? { rain, river }
        : DEFAULT_RISK_WEIGHTS,
    );
  }

  /** Subscribe the engine to the four triggers once the module is up. */
  async onModuleInit(): Promise<void> {
    await this.eventBus.subscribe(EVENT_CHANNELS.WEATHER_SNAPSHOT, (p) =>
      this.onWeatherSnapshot(p.snapshotId, p.sourceCode),
    );
    await this.eventBus.subscribe(EVENT_CHANNELS.THRESHOLD_CHANGED, (p) =>
      this.recomputeStations([p.stationId]).then(() => undefined),
    );
    await this.eventBus.subscribe(EVENT_CHANNELS.EVENT_SCOPE_ASSIGNED, (p) =>
      this.recomputeStations(p.stationIds).then(() => undefined),
    );
    await this.eventBus.subscribe(EVENT_CHANNELS.EVENT_CLOSED, () =>
      // Scope freezes at assignment; on close just refresh everything cheaply
      // enough by recomputing from the latest snapshot. No-op if none yet.
      this.recomputeAll().then(() => undefined),
    );
    this.logger.log(
      `Risk Engine online (weights rain=${this.weights.rain.toFixed(2)} river=${this.weights.river.toFixed(2)})`,
    );
  }

  // ---------------------------------------------------------------------------
  // Trigger handlers
  // ---------------------------------------------------------------------------

  /** WEATHER_SNAPSHOT: forecast snapshots drive a full recompute; disaster ones are ignored. */
  private async onWeatherSnapshot(
    snapshotId: string,
    source: string,
  ): Promise<void> {
    // Disaster sources never carry forecast data → ignore them.
    if (source === 'GDACS' || source === 'EONET' || source === 'ReliefWeb') return;
    await this.recomputeAll(snapshotId);
  }

  // ---------------------------------------------------------------------------
  // Full recompute (single-flight via Redis lock)
  // ---------------------------------------------------------------------------

  /**
   * Recompute risk for every active station off a forecast snapshot. If no
   * snapshotId is given, the latest successful forecast snapshot is used. Guarded
   * by a cluster-wide lock so only one instance does the work per snapshot.
   */
  async recomputeAll(snapshotId?: string): Promise<{ stations: number }> {
    const sid = snapshotId ?? (await this.latestForecastSnapshotId());
    if (!sid) {
      this.logger.warn('recomputeAll: no forecast snapshot available yet');
      return { stations: 0 };
    }

    const token = `${process.pid}-${Date.now()}`;
    const acquired = await this.redis.client.set(
      RISK_RECOMPUTE_LOCK_KEY,
      token,
      'PX',
      RISK_RECOMPUTE_LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) {
      this.logger.debug('recomputeAll: another instance holds the lock; skipping');
      return { stations: 0 };
    }

    try {
      const stations = await this.loadStations();
      const count = await this.computeAndPersist(stations, sid, sid);
      this.logger.log(
        `recomputeAll: scored ${count} stations from snapshot ${sid}`,
      );
      return { stations: count };
    } finally {
      // Best-effort release (only if we still hold it).
      const holder = await this.redis.client.get(RISK_RECOMPUTE_LOCK_KEY);
      if (holder === token) await this.redis.client.del(RISK_RECOMPUTE_LOCK_KEY);
    }
  }

  // ---------------------------------------------------------------------------
  // Targeted recompute (threshold / scope changes) — small, runs unlocked
  // ---------------------------------------------------------------------------

  /** Recompute a specific set of stations off the latest forecast snapshot. */
  async recomputeStations(stationIds: number[]): Promise<{ stations: number }> {
    if (stationIds.length === 0) return { stations: 0 };
    const sid = await this.latestForecastSnapshotId();
    if (!sid) return { stations: 0 };

    const stations = await this.loadStations(stationIds);
    const count = await this.computeAndPersist(stations, sid, sid);
    this.logger.log(`recomputeStations: scored ${count}/${stationIds.length}`);
    return { stations: count };
  }

  // ---------------------------------------------------------------------------
  // Core: compute verdicts + persist + emit deltas
  // ---------------------------------------------------------------------------

  /**
   * Score every supplied station over the 5–7 day horizon and persist the result.
   * `weatherSnapshotId` is copied onto any alert_histories raised this run.
   * Returns how many stations actually had forecast data to score.
   */
  private async computeAndPersist(
    stations: StationRow[],
    forecastSnapshotId: string,
    weatherSnapshotId: string,
  ): Promise<number> {
    if (stations.length === 0) return 0;
    const stationIds = stations.map((s) => s.id);

    const [forecastsByStation, tiersByStation, percentiles, eventByStation] =
      await Promise.all([
        this.loadDailyForecasts(forecastSnapshotId, stationIds),
        this.loadThresholds(stationIds),
        this.loadProvincePercentiles(),
        this.loadEventTags(stationIds),
      ]);

    const { from, to } = this.horizon();
    const rows: AssessmentInsert[] = [];
    const alerts: AlertInsert[] = [];
    const deltas: { station: StationRow; status: RiskStatus }[] = [];
    const processed: number[] = [];

    for (const station of stations) {
      const series = forecastsByStation.get(station.id);
      if (!series || series.length === 0) continue; // nothing to score
      processed.push(station.id);

      const tiers = tiersByStation.get(station.id) ?? [];
      const pct = station.provinceId
        ? percentiles.get(station.provinceId)
        : undefined;
      const E = elevationIndex(station.elevation, pct?.p10 ?? null, pct?.p90 ?? null);
      const eventId = eventByStation.get(station.id) ?? null;

      let worstLevel = 0;
      let worstVerdict: RiskVerdict | null = null;
      let worstDate = '';

      // Only days inside [today, today+horizon] feed the timeline.
      const horizonDays = series.filter(
        (d) => d.forecastDate >= from && d.forecastDate <= to,
      );

      for (let i = 0; i < horizonDays.length; i++) {
        const day = horizonDays[i];
        const rain3day =
          day.rainfall +
          (horizonDays[i - 1]?.rainfall ?? 0) +
          (horizonDays[i - 2]?.rainfall ?? 0);

        const components: RiskComponents = {
          R: rainIndex(day.rainfall, rain3day),
          V: riverIndex(day.riverWaterLevel, tiers),
          E,
          rain24h: day.rainfall,
          rain3day,
          riverLevel: day.riverWaterLevel,
        };
        const verdict = assessRisk(components, tiers as ThresholdTier[], this.weights);

        rows.push({
          stationId: station.id,
          eventId,
          forecastDate: day.forecastDate,
          predictedWaterLevel: verdict.predictedWaterLevel,
          thresholdValue: verdict.thresholdValue,
          isExceeded: verdict.isExceeded,
          severity: verdict.severity,
          riskScore: verdict.riskScore,
        });

        if (verdict.alertLevel > worstLevel) {
          worstLevel = verdict.alertLevel;
          worstVerdict = verdict;
          worstDate = day.forecastDate;
        }
      }

      const newStatus = alertLevelToRiskStatus(worstLevel);
      if (newStatus !== station.riskStatus) {
        deltas.push({ station, status: newStatus });
      }

      // Raise an immutable alert record only on escalation into WARNING/DANGER —
      // not on every recompute — so the history stays a true trigger log.
      if (
        worstVerdict &&
        worstLevel >= 2 &&
        riskStatusRank(newStatus) > riskStatusRank(station.riskStatus)
      ) {
        alerts.push({
          stationId: station.id,
          eventId,
          alertLevel: worstLevel,
          triggeredAt: new Date(),
          actualValue: worstVerdict.predictedWaterLevel,
          thresholdValue: worstVerdict.thresholdValue,
          reason: `[${worstDate}] ${worstVerdict.reason}`,
          weatherSnapshotId,
        });
      }
    }

    await this.persist(processed, from, to, rows, deltas, alerts);
    this.emitDeltas(deltas);
    return processed.length;
  }

  /**
   * One transaction: clear the horizon's stale assessments for the processed
   * stations, bulk-insert the fresh rows, update changed station.risk_status, and
   * append any new alert_histories. Replace-then-insert (rather than upsert) keeps
   * the write simple without needing a unique constraint on (station_id, date).
   */
  private async persist(
    processedStationIds: number[],
    from: string,
    to: string,
    rows: AssessmentInsert[],
    deltas: { station: StationRow; status: RiskStatus }[],
    alerts: AlertInsert[],
  ): Promise<void> {
    if (processedStationIds.length === 0) return;

    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager
        .createQueryBuilder()
        .delete()
        .from(StationRiskAssessment)
        .where('station_id IN (:...ids)', { ids: processedStationIds })
        .andWhere('forecast_date BETWEEN :from AND :to', { from, to })
        .execute();

      for (let i = 0; i < rows.length; i += ASSESSMENT_CHUNK) {
        await manager.insert(
          StationRiskAssessment,
          rows.slice(i, i + ASSESSMENT_CHUNK),
        );
      }

      for (const d of deltas) {
        await manager.update(
          'stations',
          { id: d.station.id },
          { riskStatus: d.status },
        );
      }

      if (alerts.length > 0) {
        await manager.insert(AlertHistory, alerts);
      }
    });
  }

  /** Publish a RISK_DELTA per changed station (fire-and-forget, carries coords). */
  private emitDeltas(
    deltas: { station: StationRow; status: RiskStatus }[],
  ): void {
    for (const d of deltas) {
      if (d.station.longitude == null || d.station.latitude == null) continue;
      void this.realtime
        .emitRiskDelta({
          stationId: d.station.id,
          riskStatus: d.status,
          lng: d.station.longitude,
          lat: d.station.latitude,
        })
        .catch((err) =>
          this.logger.error(
            `emitRiskDelta failed for station=${d.station.id}: ${(err as Error).message}`,
          ),
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private horizon(): { from: string; to: string } {
    const today = new Date();
    const to = new Date(today);
    to.setDate(to.getDate() + RISK_HORIZON_DAYS);
    return { from: toDateStr(today), to: toDateStr(to) };
  }

  /** Latest SUCCESS forecast snapshot (disaster sources excluded). */
  private async latestForecastSnapshotId(): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM weather_snapshots
        WHERE status = 'SUCCESS' AND source_code NOT IN ('GDACS','EONET','ReliefWeb')
        ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  private async loadStations(stationIds?: number[]): Promise<StationRow[]> {
    const filter = stationIds?.length ? 'AND id = ANY($1)' : '';
    const params = stationIds?.length ? [stationIds] : [];
    const rows = await this.dataSource.query<
      {
        id: number;
        elevation: string | null;
        province_id: number | null;
        latitude: string | null;
        longitude: string | null;
        risk_status: RiskStatus | null;
      }[]
    >(
      `SELECT id, elevation, province_id, latitude, longitude, risk_status
         FROM stations
        WHERE is_deleted = false ${filter}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      elevation: r.elevation != null ? Number(r.elevation) : null,
      provinceId: r.province_id,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      riskStatus: r.risk_status,
    }));
  }

  /** Per-station daily aggregation from one snapshot (rain summed, river level peaked). */
  private async loadDailyForecasts(
    snapshotId: string,
    stationIds: number[],
  ): Promise<Map<number, DailyForecast[]>> {
    const rows = await this.dataSource.query<
      {
        station_id: number;
        forecast_date: string;
        rainfall: string | null;
        river_water_level: string | null;
      }[]
    >(
      `SELECT station_id,
              (forecast_time)::date AS forecast_date,
              COALESCE(SUM(rainfall), 0) AS rainfall,
              MAX(river_water_level)     AS river_water_level
         FROM weather_forecasts
        WHERE snapshot_id = $1
          AND station_id = ANY($2)
        GROUP BY station_id, (forecast_time)::date
        ORDER BY station_id, forecast_date`,
      [snapshotId, stationIds],
    );

    const map = new Map<number, DailyForecast[]>();
    for (const r of rows) {
      const arr = map.get(r.station_id) ?? [];
      arr.push({
        forecastDate: toDateStr(new Date(r.forecast_date)),
        rainfall: r.rainfall != null ? Number(r.rainfall) : 0,
        riverWaterLevel:
          r.river_water_level != null ? Number(r.river_water_level) : null,
      });
      map.set(r.station_id, arr);
    }
    return map;
  }

  private async loadThresholds(
    stationIds: number[],
  ): Promise<Map<number, ThresholdTier[]>> {
    const rows = await this.dataSource.query<
      { station_id: number; alert_level: number; threshold_value: string }[]
    >(
      `SELECT station_id, alert_level, threshold_value
         FROM flood_thresholds
        WHERE station_id = ANY($1)
        ORDER BY station_id, alert_level`,
      [stationIds],
    );
    const map = new Map<number, ThresholdTier[]>();
    for (const r of rows) {
      const arr = map.get(r.station_id) ?? [];
      arr.push({
        alertLevel: r.alert_level,
        thresholdValue: Number(r.threshold_value),
      });
      map.set(r.station_id, arr);
    }
    return map;
  }

  /** Per-province elevation p10/p90 for the relative E normalization. */
  private async loadProvincePercentiles(): Promise<
    Map<number, { p10: number; p90: number }>
  > {
    const rows = await this.dataSource.query<
      { province_id: number; p10: string | null; p90: string | null }[]
    >(
      `SELECT province_id,
              percentile_cont(0.1) WITHIN GROUP (ORDER BY elevation) AS p10,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY elevation) AS p90
         FROM stations
        WHERE is_deleted = false
          AND elevation IS NOT NULL
          AND province_id IS NOT NULL
        GROUP BY province_id`,
    );
    const map = new Map<number, { p10: number; p90: number }>();
    for (const r of rows) {
      if (r.p10 != null && r.p90 != null) {
        map.set(r.province_id, { p10: Number(r.p10), p90: Number(r.p90) });
      }
    }
    return map;
  }

  /** Tag each station with an ONGOING event it's scoped into (if any). */
  private async loadEventTags(
    stationIds: number[],
  ): Promise<Map<number, string>> {
    const rows = await this.dataSource.query<
      { station_id: number; event_id: string }[]
    >(
      `SELECT es.station_id, MIN(es.event_id) AS event_id
         FROM event_stations es
         JOIN disaster_events de
           ON de.id = es.event_id AND de.status = 'ONGOING'
        WHERE es.station_id = ANY($1)
        GROUP BY es.station_id`,
      [stationIds],
    );
    const map = new Map<number, string>();
    for (const r of rows) map.set(r.station_id, String(r.event_id));
    return map;
  }
}

/** Format a Date as YYYY-MM-DD (date-only key matching the DATE column). */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
