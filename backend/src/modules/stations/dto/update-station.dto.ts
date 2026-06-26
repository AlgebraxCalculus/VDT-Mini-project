import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * PUT /stations/{id} — API 15. station_code is immutable (it's the external
 * key). If latitude/longitude are supplied they must come as a pair (enforced
 * in the service) so geom + province auto-assignment stay consistent.
 */
export class UpdateStationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  // Same Vietnam bounding box as CreateStationDto (mainland + offshore islands)
  // — keep the two in sync so an edit can't push a station outside the bounds a
  // create would have rejected.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(6)
  @Max(24)
  latitude?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(102)
  @Max(118)
  longitude?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-500)
  @Max(9000)
  elevation?: number;
}
