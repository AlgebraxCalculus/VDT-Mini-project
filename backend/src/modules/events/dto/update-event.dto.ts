import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * PUT /events/{id} — API 23. Only mutable descriptive fields. status transitions
 * go through the dedicated close endpoint; the service rejects any edit once the
 * event is CLOSED.
 */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
