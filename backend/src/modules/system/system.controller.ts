import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../users/entities/role.entity';
import { JobsService } from './jobs.service';
import { RecentJob } from './system.types';

/** Newest-first cap for the dashboard's recent-jobs panel. */
const RECENT_JOBS_LIMIT = 15;

/**
 * Operational/infra reads for the Health dashboard. Admin-only, mirroring the
 * RBAC of API 35 (integrations health) which sits beside it on the same screen.
 */
@Controller('system')
export class SystemController {
  constructor(private readonly jobs: JobsService) {}

  /** GET /system/jobs — recent background jobs across all BullMQ queues. */
  @Roles(RoleCode.ADMIN)
  @Get('jobs')
  recentJobs(): Promise<RecentJob[]> {
    return this.jobs.getRecentJobs(RECENT_JOBS_LIMIT);
  }
}
