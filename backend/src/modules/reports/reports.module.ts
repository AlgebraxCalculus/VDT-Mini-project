import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportProcessor } from './reports.processor';
import { REPORT_QUEUE } from './reports.constants';

/**
 * Group H — report export (APIs 40–43). The render job reads the pre-computed
 * tables via the global DataSource (no TypeOrmModule.forFeature needed — all SQL
 * is raw), and stores artifacts via the global RedisService. attempts: 1 keeps a
 * render from silently re-running; the client can simply re-request a report.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: REPORT_QUEUE,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportProcessor],
})
export class ReportsModule {}
