import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional } from 'class-validator';
import { WeatherSource } from '../entities/weather-snapshot.entity';

/**
 * API 31 body. All fields optional: with none set, refresh covers all active
 * stations. `source` forces a specific source (e.g. GDACS for disaster data);
 * otherwise the fallback chain is used.
 */
export class RefreshWeatherDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsInt({ each: true })
  @Type(() => Number)
  stationIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Type(() => Number)
  provinceIds?: number[];

  @IsOptional()
  @IsEnum(WeatherSource)
  source?: WeatherSource;
}
