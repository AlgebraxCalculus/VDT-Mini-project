import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';
import { WeatherSource } from './entities/weather-snapshot.entity';
import { GlofasProvider, RiverTarget } from './providers/glofas.provider';

/**
 * Daily GloFAS driver. Pulls river discharge once/day from Copernicus EWDS, writes
 * it into the latest forecast snapshot's `weather_forecasts.river_water_level`, and
 * republishes WEATHER_SNAPSHOT so the Risk Engine recomputes with river data.
 * Skipped when EWDS_PAT is unset. GRIB→station extraction runs via a Python sidecar
 * (cfgrib); discharge (m³/s) is converted to a stage (m) per station (see
 * {@link dischargeToLevels}) so it's comparable to flood_thresholds.
 */
@Injectable()
export class GlofasService {
  private readonly logger = new Logger(GlofasService.name);

  /**
   * Rating-curve tuning. GloFAS gives discharge (m³/s) but thresholds are stages (m),
   * so discharge is mapped to a stage on each station's own scale, self-anchored to
   * the cell's baseline flow: ratio = Q_day / Q_baseline, onset → BĐ1, danger → top
   * tier, log-linear between. Magnitude-independent; real accuracy needs calibrated
   * KTTV/NCHMF curves.
   */
  private readonly onsetRatio: number;
  private readonly dangerRatio: number;
  private readonly defaultBandM: number;

  constructor(
    private readonly glofas: GlofasProvider,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
  ) {
    // Flood onset at 1.5× the cell's baseline flow; "danger" (top tier) at 4×.
    this.onsetRatio = Number(process.env.GLOFAS_ONSET_RATIO ?? '1.5');
    this.dangerRatio = Number(process.env.GLOFAS_DANGER_RATIO ?? '4');
    // Fallback alert-band width (m) for stations with a single configured tier.
    this.defaultBandM = Number(process.env.GLOFAS_DEFAULT_BAND_M ?? '3');
  }

  @Cron(process.env.GLOFAS_CRON ?? '30 6 * * *', { name: 'glofas-river' })
  async scheduledPull(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`GloFAS daily pull failed: ${(err as Error).message}`);
    }
  }

  /** One pull → DB enrichment → recompute trigger. Returns #stations enriched. */
  async run(): Promise<number> {
    if (!this.glofas.isConfigured()) {
      this.logger.warn('GloFAS skipped: EWDS_PAT not configured');
      return 0;
    }

    const snapshotId = await this.latestForecastSnapshotId();
    if (!snapshotId) {
      this.logger.warn('GloFAS skipped: no SUCCESS forecast snapshot to enrich');
      return 0;
    }

    const targets = await this.loadTargets();
    if (targets.length === 0) return 0;

    const byStation = await this.glofas.fetchRiverDischarge(targets);
    if (byStation.size === 0) {
      // Downloaded but extraction produced nothing (sidecar gap).
      this.logger.warn(
        'GloFAS: 0 stations enriched (GRIB extraction sidecar unavailable — see note.txt)',
      );
      return 0;
    }

    // Convert discharge → per-station stage so it's comparable to flood_thresholds.
    const tiersByStation = await this.loadThresholds([...byStation.keys()]);
    const levelsByStation = this.dischargeToLevels(byStation, tiersByStation);

    const enriched = await this.applyRiverLevels(snapshotId, levelsByStation);
    this.logger.log(
      `GloFAS: river levels written for ${enriched} stations on snapshot ${snapshotId}`,
    );

    // Republish under a forecast source code so the engine doesn't skip it as a disaster.
    await this.eventBus.publish(EVENT_CHANNELS.WEATHER_SNAPSHOT, {
      snapshotId,
      sourceCode: WeatherSource.OPEN_METEO,
    });
    return enriched;
  }

  /** Latest SUCCESS forecast snapshot (disaster sources excluded). */
  private async latestForecastSnapshotId(): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM weather_snapshots
        WHERE status = 'SUCCESS' AND source_code NOT IN ('GDACS','EONET','ReliefWeb','GloFAS')
        ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  private async loadTargets(): Promise<RiverTarget[]> {
    const rows = await this.dataSource.query<
      { id: number; latitude: string | null; longitude: string | null }[]
    >(
      `SELECT id, latitude, longitude FROM stations
        WHERE is_deleted = false AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    );
    return rows.map((r) => ({
      stationId: r.id,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));
  }

  /** Ascending flood-threshold tiers (m) per station, for the stage mapping. */
  private async loadThresholds(
    stationIds: number[],
  ): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (stationIds.length === 0) return map;
    const rows = await this.dataSource.query<
      { station_id: number; threshold_value: string }[]
    >(
      `SELECT station_id, threshold_value FROM flood_thresholds
        WHERE station_id = ANY($1)
        ORDER BY station_id, threshold_value ASC`,
      [stationIds],
    );
    for (const r of rows) {
      const arr = map.get(r.station_id) ?? [];
      arr.push(Number(r.threshold_value));
      map.set(r.station_id, arr);
    }
    return map;
  }

  /**
   * Convert each station's discharge series → stage on its own threshold scale (see
   * the class rating-curve note). Tier-less stations are dropped — the engine ignores
   * river for them anyway.
   */
  private dischargeToLevels(
    byStation: Map<number, { date: string; discharge: number }[]>,
    tiersByStation: Map<number, number[]>,
  ): Map<number, { date: string; value: number }[]> {
    const out = new Map<number, { date: string; value: number }[]>();
    const lnOnset = Math.log(this.onsetRatio);
    const lnDanger = Math.log(this.dangerRatio);
    const span = lnDanger - lnOnset || 1;

    for (const [stationId, series] of byStation) {
      const tiers = tiersByStation.get(stationId);
      if (!tiers || tiers.length === 0 || series.length === 0) continue;

      const t1 = tiers[0];
      const tTop = tiers[tiers.length - 1];
      const band = tTop > t1 ? tTop - t1 : this.defaultBandM;

      // Baseline = the cell's lowest flow over the window (~normal flow).
      const baseline = Math.max(
        Math.min(...series.map((d) => d.discharge)),
        1e-6,
      );

      const converted: { date: string; value: number }[] = [];
      for (const d of series) {
        const ratio = d.discharge / baseline;
        const frac = (Math.log(Math.max(ratio, 1e-6)) - lnOnset) / span;
        // frac=0 → BĐ1 (t1); frac=1 → top tier (tTop); extrapolates either side.
        const level = Math.max(0, t1 + frac * band);
        converted.push({ date: d.date, value: Math.round(level * 100) / 100 });
      }
      out.set(stationId, converted);
    }
    return out;
  }

  /**
   * Set river_water_level by date in one set-based UPDATE via unnest arrays (10k
   * stations × ~7 days is too many for per-row queries). Returns #stations touched.
   */
  private async applyRiverLevels(
    snapshotId: string,
    byStation: Map<number, { date: string; value: number }[]>,
  ): Promise<number> {
    const sids: number[] = [];
    const dates: string[] = [];
    const vals: number[] = [];
    for (const [stationId, series] of byStation) {
      for (const d of series) {
        sids.push(stationId);
        dates.push(d.date);
        vals.push(d.value);
      }
    }
    if (sids.length === 0) return 0;

    await this.dataSource.query(
      `UPDATE weather_forecasts wf
          SET river_water_level = v.level
         FROM (
           SELECT unnest($1::int[])   AS sid,
                  unnest($2::date[])  AS d,
                  unnest($3::float[]) AS level
         ) v
        WHERE wf.snapshot_id = $4
          AND wf.station_id = v.sid
          AND (wf.forecast_time)::date = v.d`,
      [sids, dates, vals, snapshotId],
    );
    return byStation.size;
  }
}
