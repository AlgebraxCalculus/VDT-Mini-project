import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Shared viewport rectangle for every Group E (map / GIS) query. The four corners
 * are required and coerced from the query string; each map endpoint extends this
 * with its own extra params. Mirrors the bbox contract of GET /stations/viewport.
 * Coordinates feed ST_MakeEnvelope(minLng,minLat,maxLng,maxLat,4326).
 */
export class MapViewportDto {
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
}
