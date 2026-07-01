import { Controller, Get, Query } from '@nestjs/common';
import { MapService } from './map.service';
import { MapStationsDto } from './dto/map-stations.dto';
import { MapEventsDto } from './dto/map-events.dto';
import { MapWeatherDto } from './dto/map-weather.dto';
import { MapSearchDto } from './dto/map-search.dto';

/**
 * Group E — Map / GIS by viewport BBOX (APIs 27–30). All four are read-only
 * viewport queries open to any authenticated user (Viewer+) per the RBAC matrix
 * ("Xem bản đồ" = all roles); auth is enforced globally by JwtAuthGuard.
 */
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  /**
   * API 30 — GET /map/stations/search. Declared before the `stations` route for
   * clarity (literal paths, so no actual collision). Free-text + risk filter
   * within the viewport.
   */
  @Get('stations/search')
  search(@Query() query: MapSearchDto) {
    return this.mapService.getSearch(query);
  }

  /** API 27 — GET /map/stations. Stations + risk; clustered when zoomed out. */
  @Get('stations')
  stations(@Query() query: MapStationsDto) {
    return this.mapService.getStations(query);
  }

  /** API 28 — GET /map/events. Active events + affected polygon in the viewport. */
  @Get('events')
  events(@Query() query: MapEventsDto) {
    return this.mapService.getEvents(query);
  }

  /** API 29 — GET /map/weather. Forecast field overlay (rain/wind/temp) points. */
  @Get('weather')
  weather(@Query() query: MapWeatherDto) {
    return this.mapService.getWeatherOverlay(query);
  }
}
