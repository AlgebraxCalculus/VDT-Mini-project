import { IsEnum, IsOptional } from 'class-validator';
import { WeatherSource } from '../entities/weather-snapshot.entity';

/** API 33 query: optionally filter the latest snapshot by source. */
export class QuerySnapshotDto {
  @IsOptional()
  @IsEnum(WeatherSource)
  source?: WeatherSource;
}
