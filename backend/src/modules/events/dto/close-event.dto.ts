import { IsDateString, IsOptional } from 'class-validator';

/** POST /events/{id}/close — API 24. Defaults end_time to now() when omitted. */
export class CloseEventDto {
  @IsOptional()
  @IsDateString()
  endTime?: string;
}
