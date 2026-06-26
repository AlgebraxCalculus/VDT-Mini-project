import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /events — API 22. status is always set to ONGOING by the service;
 * event_code is auto-generated from the disaster type. Scope (provinces/stations)
 * is assigned separately via API 25.
 */
export class CreateEventDto {
  @IsInt()
  disasterTypeId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  /** ISO 8601; defaults to now() when omitted. */
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
