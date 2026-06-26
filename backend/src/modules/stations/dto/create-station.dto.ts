import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AlertLevel } from '../entities/flood-threshold.entity';

/**
 * One flood-threshold tier supplied when creating/configuring a station.
 * alertLevel: 1 = Chú ý, 2 = Cảnh báo, 3 = Nguy hiểm.
 */
export class ThresholdInputDto {
  @IsEnum(AlertLevel)
  alertLevel: AlertLevel;

  @IsNumber({ maxDecimalPlaces: 2 })
  thresholdValue: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

/** POST /stations — API 14. Coordinates drive ST_Contains province assignment. */
export class CreateStationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  // Station codes are referenced in reports/imports — keep them URL/CSV-safe.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'stationCode may only contain letters, digits, "-" and "_"',
  })
  stationCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // Coordinates are constrained to Vietnam's bounding box (mainland + Hoàng Sa /
  // Trường Sa offshore islands) rather than the whole globe. This catches the
  // common data-entry mistakes — swapped lat/lng, missing minus sign, a typo
  // like 200 — instead of silently storing an unmappable point. A point inside
  // the box but outside every province boundary still saves (province_id stays
  // NULL); the box is a sanity bound, not a province check.
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(6)
  @Max(24)
  latitude: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(102)
  @Max(118)
  longitude: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-500)
  @Max(9000)
  elevation?: number;

  /** Optional initial threshold tiers; can also be set later via API 17. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThresholdInputDto)
  thresholds?: ThresholdInputDto[];
}
