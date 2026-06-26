import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { ThresholdInputDto } from './create-station.dto';

/**
 * PUT /stations/{id}/thresholds — API 17. Replaces the station's threshold set
 * (max 3 tiers: WATCH/WARNING/DANGER) and re-triggers risk computation.
 */
export class SetThresholdsDto {
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ThresholdInputDto)
  thresholds: ThresholdInputDto[];
}
