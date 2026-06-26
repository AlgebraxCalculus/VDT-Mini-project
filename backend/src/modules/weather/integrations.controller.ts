import { Controller, Get } from '@nestjs/common';
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

  /** GET /integrations/health. */
  @Roles(RoleCode.ADMIN)
  @Get('health')
  getHealth() {
    return this.healthMonitor.getAll();
  }
}
