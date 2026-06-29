import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /stations/{id}/alert-history?page=&size= — API 39. */
export class QueryAlertHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;
}
