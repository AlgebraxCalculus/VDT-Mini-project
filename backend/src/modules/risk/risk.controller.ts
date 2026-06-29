import { Controller, Get, Query } from '@nestjs/common';
import { QueryRiskStationsDto } from './dto/query-risk-stations.dto';
import { RiskService } from './risk.service';

/**
 * Group G — at-risk station list (API 36). Read-only, open to any authenticated
 * user (Viewer+) per the RBAC matrix; auth is enforced globally by JwtAuthGuard.
 */
@Controller('risk')
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  /** API 36 — GET /risk/stations: 5–7 day at-risk stations from the pre-computed table. */
  @Get('stations')
  findRiskStations(@Query() query: QueryRiskStationsDto) {
    return this.riskService.findRiskStations(query);
  }
}
