import { IsEnum, IsOptional } from 'class-validator';
import { MapViewportDto } from './map-viewport.dto';

/** Weather overlay field the client can lazy-load over the map. */
export enum WeatherLayer {
  RAIN = 'rain',
  WIND = 'wind',
  TEMP = 'temp',
}

/**
 * API 29 — GET /map/weather?minLng=&minLat=&maxLng=&maxLat=&layer= .
 *
 * Design note: the original spec was a raster tile endpoint
 * (`/map/weather/tiles/{layer}/{z}/{x}/{y}`) served from OpenWeatherMap. OWM was
 * dropped from the system (see the design PDF §8) and there is no raster source,
 * so this is implemented as a **data-driven point overlay**: the latest forecast
 * field per station inside the viewport, which the client renders as soft circles
 * (the same shape the previous mock fed). No raster engine, no new deps.
 */
export class MapWeatherDto extends MapViewportDto {
  @IsOptional()
  @IsEnum(WeatherLayer)
  layer: WeatherLayer = WeatherLayer.RAIN;
}
