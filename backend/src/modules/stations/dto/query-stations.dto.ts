import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RiskStatus } from '../entities/station.entity';

/** GET /stations?province_id=&risk_status=&event_id=&q=&page=&size= — API 12. */
export class QueryStationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  /** disaster_events.id is BIGINT → keep as a numeric string. */
  @IsOptional()
  @IsNumberString()
  eventId?: string;

  /** Free-text over station_code / name. */
  @IsOptional()
  @IsString()
  q?: string;

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
