import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HealthMonitorService } from './health-monitor.service';
import { WeatherService } from './weather.service';

/**
 * Scheduled drivers for Group F:
 *   - hourly weather ingestion (enqueues the same job as API 34), and
 *   - periodic healthcheck pings cached in Redis for API 35.
 *
 * Cron expressions are read from env at module-load time (NestJS @Cron needs a
 * literal); fall back to sensible defaults.
 */
@Injectable()
export class WeatherCronService {
  private readonly logger = new Logger(WeatherCronService.name);

  constructor(
    private readonly weatherService: WeatherService,
    private readonly healthMonitor: HealthMonitorService,
  ) {}

  @Cron(process.env.WEATHER_CRON ?? CronExpression.EVERY_HOUR, {
    name: 'weather-ingest',
  })
  async scheduledIngest(): Promise<void> {
    try {
      const { jobId } = await this.weatherService.enqueueIngest();
      this.logger.log(`Scheduled ingestion enqueued (job ${jobId})`);
    } catch (err) {
      this.logger.error(`Scheduled ingestion failed: ${(err as Error).message}`);
    }
  }

  @Cron(process.env.WEATHER_HEALTHCHECK_CRON ?? CronExpression.EVERY_5_MINUTES, {
    name: 'weather-healthcheck',
  })
  async scheduledHealthcheck(): Promise<void> {
    try {
      await this.healthMonitor.runChecks();
    } catch (err) {
      this.logger.error(`Healthcheck run failed: ${(err as Error).message}`);
    }
  }
}
