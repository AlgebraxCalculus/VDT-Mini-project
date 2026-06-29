import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { QueryAlertHistoryDto } from './dto/query-alert-history.dto';
import { RiskService } from './risk.service';

/**
 * Group G — alert reason & history (API 39). Lives under the `/stations` prefix to
 * match the spec path; NestJS happily runs a second controller on that prefix
 * alongside StationsController. Read-only (Viewer+).
 */
@Controller('stations')
export class AlertHistoryController {
  constructor(private readonly riskService: RiskService) {}

  /** API 39 — GET /stations/{id}/alert-history: actual-vs-threshold trigger log. */
  @Get(':id/alert-history')
  getAlertHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryAlertHistoryDto,
  ) {
    return this.riskService.getAlertHistory(id, query);
  }
}
