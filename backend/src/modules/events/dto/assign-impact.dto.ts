import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional } from 'class-validator';
import {
  GeoMultiPolygon,
  GeoPolygon,
} from '../../../common/types/geometry.types';

/**
 * POST /events/{id}/impact — API 25. Manually (re)assign an event's scope; this
 * REPLACES the auto-assigned scope. Provide `provinceIds`, an `affectedArea`
 * GeoJSON polygon, or both (the polygon footprint constrained to those provinces).
 * At least one is required (enforced in the service).
 */
export class AssignImpactDto {
  /** Provinces to scope the event to (and/or to constrain the polygon footprint). */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  provinceIds?: number[];

  /** GeoJSON Polygon/MultiPolygon footprint (SRID 4326). Validated in the service. */
  @IsOptional()
  @IsObject()
  affectedArea?: GeoPolygon | GeoMultiPolygon;
}
