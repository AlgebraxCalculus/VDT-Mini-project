import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WEATHER_JOB, WEATHER_QUEUE } from './weather.constants';
import { WeatherIngestionService } from './weather-ingestion.service';
import { WeatherJobData, WeatherService } from './weather.service';

/**
 * BullMQ worker for weather ingestion. Runs in-process with the API for now
 * (can be split into its own container later). Both 'refresh' and 'ingest' jobs
 * funnel into the same ingestion flow; the manual-refresh debounce lock is
 * released here once the job settles.
 */
@Processor(WEATHER_QUEUE)
export class WeatherProcessor extends WorkerHost {
  private readonly logger = new Logger(WeatherProcessor.name);

  constructor(
    private readonly ingestion: WeatherIngestionService,
    private readonly weatherService: WeatherService,
  ) {
    super();
  }

  async process(job: Job<WeatherJobData>): Promise<{ snapshotId: string }> {
    try {
      return await this.ingestion.ingest({
        trigger: job.data.trigger,
        triggeredBy: job.data.triggeredBy,
        stationIds: job.data.stationIds,
        provinceIds: job.data.provinceIds,
        source: job.data.source,
      });
    } finally {
      if (job.name === WEATHER_JOB.REFRESH && job.id) {
        await this.weatherService
          .releaseRefreshLock(String(job.id))
          .catch((err) =>
            this.logger.warn(`lock release failed: ${(err as Error).message}`),
          );
      }
    }
  }
}
