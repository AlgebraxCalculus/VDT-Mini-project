import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { RiskStatus } from '../entities/station.entity';

/**
 * GET /stations/viewport?minLng=&minLat=&maxLng=&maxLat=&riskStatus=&limit= .
 *
 * Map BBOX query: returns only the stations whose point falls inside the
 * current viewport rectangle, served by the GIST index on station.geom via
 * ST_MakeEnvelope/ST_Contains. The four corners are required; coordinates are
 * coerced from the query string and range-checked (lng ∈ [-180,180],
 * lat ∈ [-90,90]).
 */
export class ViewportStationsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  minLng: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  minLat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  maxLng: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  maxLat: number;

  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  /**
   * Safety cap on rows returned in one viewport (markers cluster client-side).
   * Default covers the full target dataset for a fully zoomed-out view; results
   * are risk-ordered so a truncation keeps the highest-risk stations.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit = 10000;
}
