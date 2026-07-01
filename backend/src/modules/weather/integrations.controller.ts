import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../users/entities/role.entity';
import { HealthMonitorService } from './health-monitor.service';

/** API 35 — external-source healthcheck (Admin-only), reading cached ping results from Redis. */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly healthMonitor: HealthMonitorService) {}

  /** GET /integrations/health — the last cached results (fast, no probing). */
  @Roles(RoleCode.ADMIN)
  @Get('health')
  getHealth() {
    return this.healthMonitor.getAll();
  }

  /**
   * POST /integrations/health/refresh — probe every source now and return fresh
   * results (on-demand re-check without waiting for the cron). 200: returns state, not a resource.
   */
  @Roles(RoleCode.ADMIN)
  @Post('health/refresh')
  @HttpCode(200)
  async refreshHealth() {
    await this.healthMonitor.runChecks();
    return this.healthMonitor.getAll();
  }
}
