import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { StationRiskAssessment } from './entities/station-risk-assessment.entity';
import { AlertHistory } from './entities/alert-history.entity';
import { Station } from '../stations/entities/station.entity';
import { Province } from '../provinces/entities/province.entity';
import { FloodThreshold } from '../stations/entities/flood-threshold.entity';
import {
  QueryRiskStationsDto,
  RiskSort,
} from './dto/query-risk-stations.dto';
import { QueryForecastDto } from './dto/query-forecast.dto';
import { QueryAlertHistoryDto } from './dto/query-alert-history.dto';
import { RISK_HORIZON_DAYS } from './risk.constants';
import {
  assessRisk,
  elevationIndex,
  rainIndex,
  riverIndex,
  deriveWeightProfiles,
  weightsForStation,
  RiskVerdict,
  RiskWeightProfiles,
  ThresholdTier,
} from './risk-formula';

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
}

/** One aggregated point in a forecast time-series (province or station). */
export interface ForecastPoint {
  date: string;
  temperature: number | null;
  rainfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  riverWaterLevel: number | null;
}

/** A station forecast point enriched with the day's risk classification (API 38). */
export interface ClassifiedForecastPoint extends ForecastPoint {
  severity: RiskVerdict['severity'];
  alertLevel: number;
  isExceeded: boolean;
  riskScore: number;
}

/**
 * Group G read side (APIs 36–39). Every endpoint is read-only and queries the
 * pre-computed tables the {@link RiskEngineService} writes — risk is never
 * computed on the request path. The one exception is API 38, which classifies the
 * forecast series on the fly purely for display (no persistence).
 */
@Injectable()
export class RiskService {
  // Per-group hazard weights, resolved from the same env vars as the write-side
  // Risk Engine so API 38's on-the-fly classification matches the pre-computed
  // table. The group (river-monitored vs rain-only) is picked per station below.
  private readonly weightProfiles: RiskWeightProfiles;

  constructor(
    @InjectRepository(StationRiskAssessment)
    private readonly assessmentsRepo: Repository<StationRiskAssessment>,
    @InjectRepository(AlertHistory)
    private readonly alertsRepo: Repository<AlertHistory>,
    @InjectRepository(Station)
    private readonly stationsRepo: Repository<Station>,
    @InjectRepository(Province)
    private readonly provincesRepo: Repository<Province>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.weightProfiles = deriveWeightProfiles(
      parseFloat(this.config.get<string>('RISK_AHP_RIVER_VS_RAIN') ?? ''),
    ).profiles;
  }

  // ---------------------------------------------------------------------------
  // API 36 — GET /risk/stations
  // ---------------------------------------------------------------------------

  /**
   * Paginated at-risk stations over the forecast window. Scans
   * station_risk_assessments (index: station_id+forecast_date, severity) joined to
   * the station for its name/province. Defaults to the 5–7 day window and excludes
   * LOW unless a specific severity is requested.
   */
  async findRiskStations(
    query: QueryRiskStationsDto,
  ): Promise<Paginated<StationRiskAssessment>> {
    const { from, to } = this.resolveWindow(query.from, query.to);

    const qb = this.assessmentsRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.station', 'station')
      .leftJoinAndSelect('station.province', 'province')
      .where('station.isDeleted = false')
      .andWhere('a.forecastDate BETWEEN :from AND :to', { from, to })
      .skip((query.page - 1) * query.size)
      .take(query.size);

    if (query.severity) {
      qb.andWhere('a.severity = :severity', { severity: query.severity });
    } else if (!query.includeLow) {
      // "Danh sách trạm nguy cơ" → only stations that are actually at risk.
      // `includeLow=true` opts out to return the full set (incl. LOW).
      qb.andWhere("a.severity <> 'LOW'");
    }
    if (query.provinceId !== undefined) {
      qb.andWhere('station.provinceId = :provinceId', {
        provinceId: query.provinceId,
      });
    }
    if (query.eventId) {
      qb.andWhere('a.eventId = :eventId', { eventId: query.eventId });
    }

    if (query.sort === RiskSort.TIMELINE) {
      qb.orderBy('a.forecastDate', 'ASC').addOrderBy('a.riskScore', 'DESC');
    } else {
      qb.orderBy('a.riskScore', 'DESC').addOrderBy('a.forecastDate', 'ASC');
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: query.page, size: query.size };
  }

  // ---------------------------------------------------------------------------
  // API 37 — GET /forecasts/provinces/{id}
  // ---------------------------------------------------------------------------

  /**
   * Province-level forecast time-series, aggregated from the latest snapshot's
   * station forecasts in that province (avg temp/rain/wind/river per day). Falls
   * back to province-centroid rows if no station-level data exists.
   */
  async getProvinceForecast(
    provinceId: number,
    query: QueryForecastDto,
  ): Promise<{ provinceId: number; from: string; to: string; series: ForecastPoint[] }> {
    const province = await this.provincesRepo.findOne({
      where: { id: provinceId },
    });
    if (!province) throw new NotFoundException(`Province ${provinceId} not found`);

    const { from, to } = this.resolveWindow(query.from, query.to);
    const snapshotId = await this.latestForecastSnapshotId();
    if (!snapshotId) return { provinceId, from, to, series: [] };

    let series = await this.aggregateForecast(
      `SELECT (wf.forecast_time)::date AS date,
              AVG(wf.temperature)       AS temperature,
              AVG(wf.rainfall)          AS rainfall,
              AVG(wf.wind_speed)        AS wind_speed,
              AVG(wf.wind_direction)    AS wind_direction,
              AVG(wf.river_water_level) AS river_water_level
         FROM weather_forecasts wf
         JOIN stations s ON s.id = wf.station_id AND s.is_deleted = false
        WHERE wf.snapshot_id = $1 AND s.province_id = $2
          AND (wf.forecast_time)::date BETWEEN $3 AND $4
        GROUP BY (wf.forecast_time)::date
        ORDER BY date`,
      [snapshotId, provinceId, from, to],
    );

    if (series.length === 0) {
      // Province-centroid rows (station_id NULL) if station-level data is absent.
      series = await this.aggregateForecast(
        `SELECT (forecast_time)::date AS date,
                AVG(temperature)       AS temperature,
                AVG(rainfall)          AS rainfall,
                AVG(wind_speed)        AS wind_speed,
                AVG(wind_direction)    AS wind_direction,
                AVG(river_water_level) AS river_water_level
           FROM weather_forecasts
          WHERE snapshot_id = $1 AND province_id = $2
            AND (forecast_time)::date BETWEEN $3 AND $4
          GROUP BY (forecast_time)::date
          ORDER BY date`,
        [snapshotId, provinceId, from, to],
      );
    }

    return { provinceId, from, to, series };
  }

  // ---------------------------------------------------------------------------
  // API 38 — GET /forecasts/stations/{id}
  // ---------------------------------------------------------------------------

  /**
   * Station-level forecast time-series with each day classified against the
   * station's flood thresholds (same four-layer model as the engine). The
   * classification here is display-only — it is not persisted.
   */
  async getStationForecast(
    stationId: number,
    query: QueryForecastDto,
  ): Promise<{
    stationId: number;
    from: string;
    to: string;
    series: ClassifiedForecastPoint[];
  }> {
    const station = await this.stationsRepo.findOne({
      where: { id: stationId, isDeleted: false },
    });
    if (!station) throw new NotFoundException(`Station ${stationId} not found`);

    const { from, to } = this.resolveWindow(query.from, query.to);
    const snapshotId = await this.latestForecastSnapshotId();
    if (!snapshotId) return { stationId, from, to, series: [] };

    const raw = await this.aggregateForecast(
      `SELECT (forecast_time)::date AS date,
              AVG(temperature)       AS temperature,
              SUM(rainfall)          AS rainfall,
              AVG(wind_speed)        AS wind_speed,
              AVG(wind_direction)    AS wind_direction,
              MAX(river_water_level) AS river_water_level
         FROM weather_forecasts
        WHERE snapshot_id = $1 AND station_id = $2
          AND (forecast_time)::date BETWEEN $3 AND $4
        GROUP BY (forecast_time)::date
        ORDER BY date`,
      [snapshotId, stationId, from, to],
    );

    const tiers = await this.loadStationTiers(stationId);
    const weights = weightsForStation(tiers, this.weightProfiles);
    const pct = await this.provinceElevationPercentiles(station.provinceId);
    const E = elevationIndex(station.elevation, pct?.p10 ?? null, pct?.p90 ?? null);

    const series: ClassifiedForecastPoint[] = raw.map((d, i) => {
      const rain24h = d.rainfall ?? 0;
      const rain3day =
        rain24h + (raw[i - 1]?.rainfall ?? 0) + (raw[i - 2]?.rainfall ?? 0);
      const verdict = assessRisk(
        {
          R: rainIndex(rain24h, rain3day),
          V: riverIndex(d.riverWaterLevel, tiers),
          E,
          rain24h,
          rain3day,
          riverLevel: d.riverWaterLevel,
        },
        tiers,
        weights,
      );
      return {
        ...d,
        severity: verdict.severity,
        alertLevel: verdict.alertLevel,
        isExceeded: verdict.isExceeded,
        riskScore: verdict.riskScore,
      };
    });

    return { stationId, from, to, series };
  }

  // ---------------------------------------------------------------------------
  // API 39 — GET /stations/{id}/alert-history
  // ---------------------------------------------------------------------------

  /** Paginated, newest-first alert history for a station (actual vs threshold + reason). */
  async getAlertHistory(
    stationId: number,
    query: QueryAlertHistoryDto,
  ): Promise<Paginated<AlertHistory>> {
    const exists = await this.stationsRepo.exists({ where: { id: stationId } });
    if (!exists) throw new NotFoundException(`Station ${stationId} not found`);

    const [data, total] = await this.alertsRepo.findAndCount({
      where: { stationId },
      order: { triggeredAt: 'DESC' },
      skip: (query.page - 1) * query.size,
      take: query.size,
    });
    return { data, total, page: query.page, size: query.size };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Default the date window to [today, today+7] when the client omits it. */
  private resolveWindow(
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + RISK_HORIZON_DAYS);
    return {
      from: from ?? toDateStr(today),
      to: to ?? toDateStr(end),
    };
  }

  private async latestForecastSnapshotId(): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM weather_snapshots
        WHERE status = 'SUCCESS' AND source_code NOT IN ('GDACS','EONET','ReliefWeb')
        ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  /** Run an aggregation query and coerce the numeric/date columns to JS types. */
  private async aggregateForecast(
    sql: string,
    params: unknown[],
  ): Promise<ForecastPoint[]> {
    const rows = await this.dataSource.query<
      {
        date: string;
        temperature: string | null;
        rainfall: string | null;
        wind_speed: string | null;
        wind_direction: string | null;
        river_water_level: string | null;
      }[]
    >(sql, params);
    return rows.map((r) => ({
      date: toDateStr(new Date(r.date)),
      temperature: num(r.temperature),
      rainfall: num(r.rainfall),
      windSpeed: num(r.wind_speed),
      windDirection: num(r.wind_direction),
      riverWaterLevel: num(r.river_water_level),
    }));
  }

  private async loadStationTiers(stationId: number): Promise<ThresholdTier[]> {
    const rows = await this.dataSource.manager.find(FloodThreshold, {
      where: { stationId },
      order: { alertLevel: 'ASC' },
    });
    return rows.map((t) => ({
      alertLevel: t.alertLevel,
      thresholdValue: t.thresholdValue,
    }));
  }

  private async provinceElevationPercentiles(
    provinceId: number | null,
  ): Promise<{ p10: number; p90: number } | null> {
    if (provinceId == null) return null;
    const rows = await this.dataSource.query<
      { p10: string | null; p90: string | null }[]
    >(
      `SELECT percentile_cont(0.1) WITHIN GROUP (ORDER BY elevation) AS p10,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY elevation) AS p90
         FROM stations
        WHERE is_deleted = false AND elevation IS NOT NULL AND province_id = $1`,
      [provinceId],
    );
    const r = rows[0];
    if (!r || r.p10 == null || r.p90 == null) return null;
    return { p10: Number(r.p10), p90: Number(r.p90) };
  }
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
