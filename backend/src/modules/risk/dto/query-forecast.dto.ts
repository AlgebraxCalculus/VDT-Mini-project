import { IsDateString, IsOptional } from 'class-validator';

/**
 * GET /forecasts/provinces/{id}?from=&to=  (API 37)
 * GET /forecasts/stations/{id}?from=&to=   (API 38)
 * — the 5–7 day weather time-series window. `from`/`to` default to [today, today+7]
 * in the service.
 */
export class QueryForecastDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
