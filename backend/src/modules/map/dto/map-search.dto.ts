import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RiskStatus } from '../../stations/entities/station.entity';
import { MapViewportDto } from './map-viewport.dto';

/**
 * API 30 — GET /map/stations/search?minLng=&minLat=&maxLng=&maxLat=&q=&riskStatus= .
 *
 * Spatial search: free-text + risk filter restricted to the stations currently in
 * the viewport (the DB-backed path of "lọc/tìm trạm trong viewport"). Returns the
 * same enriched station shape as API 27's individual mode, capped to a small set.
 */
export class MapSearchDto extends MapViewportDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}
