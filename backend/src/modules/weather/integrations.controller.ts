import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../users/entities/role.entity';
import { HealthMonitorService } from './health-monitor.service';

/**
 * API 35 — external-source healthcheck. Admin-only per the RBAC matrix. Reads
 * the last cached ping result (latency / error rate / status) straight from
 * Redis, written by the healthcheck cron.
 */
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
   * POST /integrations/health/refresh — probe every source *now* (re-reading each
   * provider's current `isConfigured()`), then return the fresh results. Lets an
   * admin re-check on demand instead of waiting for the 5-minute cron — e.g. right
   * after adding a provider key/appname. 200 (not 201): it returns state, not a
   * created resource.
   */
  @Roles(RoleCode.ADMIN)
  @Post('health/refresh')
  @HttpCode(200)
  async refreshHealth() {
    await this.healthMonitor.runChecks();
    return this.healthMonitor.getAll();
  }
}
