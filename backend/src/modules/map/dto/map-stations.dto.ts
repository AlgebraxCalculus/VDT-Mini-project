import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RiskStatus } from '../../stations/entities/station.entity';
import { MapViewportDto } from './map-viewport.dto';

/**
 * API 27 — GET /map/stations?minLng=&minLat=&maxLng=&maxLat=&zoom=&riskStatus= .
 *
 * Stations inside the viewport, enriched with risk + a light forecast snapshot,
 * and server-side clustered when zoomed out (`zoom` below the cluster threshold
 * groups stations into grid cells — "gộp marker khi zoom-out"). When zoomed in,
 * individual enriched stations are returned instead.
 */
export class MapStationsDto extends MapViewportDto {
  /**
   * Client map zoom. Below the service's cluster threshold the response is
   * clustered; at/above it, individual stations are returned. Defaults high so an
   * omitted zoom yields un-clustered detail.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(22)
  zoom = 22;

  /** Optional risk filter (NORMAL/WATCH/WARNING/DANGER), applied before clustering. */
  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  /** Safety cap on individual stations returned (clusters are unbounded by count). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit = 3000;
}
