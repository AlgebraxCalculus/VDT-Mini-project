import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportFormat, ReportKind } from '../reports.constants';

/**
 * POST /reports body (API 40). Picks what the report is about (`kind`), the
 * output `format`, and the same filters the StationsView list uses so the export
 * matches what the user is looking at. `from`/`to` apply to the risk-summary kind
 * (default [today, today+7] in the service).
 */
export class CreateReportDto {
  @IsOptional()
  @IsEnum(ReportKind)
  kind: ReportKind = ReportKind.STATION_INVENTORY;

  @IsOptional()
  @IsEnum(ReportFormat)
  format: ReportFormat = ReportFormat.CSV;

  /** Filter to one province (mirrors the StationsView province dropdown). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  /** Free-text filter on station code / name / province (mirrors the search box). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** Inclusive forecast-window start (YYYY-MM-DD) — risk-summary kind. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive forecast-window end (YYYY-MM-DD) — risk-summary kind. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
