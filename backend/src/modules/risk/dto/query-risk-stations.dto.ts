import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { RiskSeverity } from '../entities/station-risk-assessment.entity';

/** Sort options for the at-risk station list (API 36). */
export enum RiskSort {
  /** Highest risk_score first (most severe). */
  SEVERITY = 'severity',
  /** Earliest forecast_date first (nearest in time). */
  TIMELINE = 'timeline',
}

/**
 * GET /risk/stations?from=&to=&severity=&province_id=&event_id=&sort=&page=&size=
 * — API 36. Scans the pre-computed `station_risk_assessments`; `from`/`to` default
 * to [today, today+7] in the service.
 */
export class QueryRiskStationsDto {
  /** Inclusive start of the forecast window (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive end of the forecast window (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(RiskSeverity)
  severity?: RiskSeverity;

  /**
   * Include LOW-severity rows. By default the list is "trạm nguy cơ" and hides
   * LOW; set `includeLow=true` to return the full set (e.g. the forecast table
   * that shows every station). Ignored when a specific `severity` is given.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeLow?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  /** disaster_events.id is BIGINT → keep as a numeric string. */
  @IsOptional()
  @IsNumberString()
  eventId?: string;

  @IsOptional()
  @IsEnum(RiskSort)
  sort: RiskSort = RiskSort.SEVERITY;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;
}
