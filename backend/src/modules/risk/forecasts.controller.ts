import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { QueryForecastDto } from './dto/query-forecast.dto';
import { RiskService } from './risk.service';

/**
 * Group G — weather forecast detail (APIs 37 & 38). Read-only (Viewer+). The
 * time-series is served from the latest snapshot; the station endpoint also
 * classifies each day against the station's thresholds for display.
 */
@Controller('forecasts')
export class ForecastsController {
  constructor(private readonly riskService: RiskService) {}

  /** API 37 — GET /forecasts/provinces/{id}: province-level aggregate series. */
  @Get('provinces/:id')
  getProvinceForecast(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryForecastDto,
  ) {
    return this.riskService.getProvinceForecast(id, query);
  }

  /** API 38 — GET /forecasts/stations/{id}: station point series + classification. */
  @Get('stations/:id')
  getStationForecast(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryForecastDto,
  ) {
    return this.riskService.getStationForecast(id, query);
  }
}
