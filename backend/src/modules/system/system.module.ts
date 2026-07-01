import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WEATHER_QUEUE } from '../weather/weather.constants';
import { REPORT_QUEUE } from '../reports/reports.constants';
import { STATION_IMPORT_QUEUE } from '../stations/import/station-import.constants';
import { SystemController } from './system.controller';
import { JobsService } from './jobs.service';

/**
 * System/infra dashboard reads. Re-registers the three job queues as read-only
 * clients (each producer module registers its own with defaultJobOptions; the
 * name is the only thing that must match) so {@link JobsService} can inspect
 * their retained jobs without owning the queues' write config or workers.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: WEATHER_QUEUE },
      { name: REPORT_QUEUE },
      { name: STATION_IMPORT_QUEUE },
    ),
  ],
  controllers: [SystemController],
  providers: [JobsService],
})
export class SystemModule {}
