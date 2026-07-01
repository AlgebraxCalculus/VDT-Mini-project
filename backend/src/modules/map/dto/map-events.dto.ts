import { IsEnum, IsOptional } from 'class-validator';
import { EventStatus } from '../../events/entities/disaster-event.entity';
import { MapViewportDto } from './map-viewport.dto';

/**
 * API 28 — GET /map/events?minLng=&minLat=&maxLng=&maxLat=&status= .
 *
 * Disaster events whose affected scope intersects the viewport, with the polygon
 * footprint to draw. Defaults to ONGOING (the active events the map highlights).
 */
export class MapEventsDto extends MapViewportDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status: EventStatus = EventStatus.ONGOING;
}
