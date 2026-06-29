import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { InternalTokenGuard } from './guards/internal-token.guard';
import { WeatherService } from './weather.service';
import { GlofasService } from './glofas.service';

/**
 * API 34 — scheduler-only ingestion trigger. Not called by browser clients:
 * the routes are @Public() (bypass the global JWT guard) and gated solely by
 * the X-Internal-Token shared secret. The cron services call the same paths.
 */
@Controller('internal/weather')
export class WeatherInternalController {
  private readonly logger = new Logger(WeatherInternalController.name);

  constructor(
    private readonly weatherService: WeatherService,
    private readonly glofas: GlofasService,
  ) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  ingest() {
    return this.weatherService.enqueueIngest();
  }

  /**
   * Trigger one GloFAS daily pull now (same work as the GLOFAS_CRON job): fetch
   * river discharge from EWDS, write river_water_level on the latest snapshot, and
   * republish WEATHER_SNAPSHOT for a recompute. Fire-and-forget — the EWDS job is
   * async (minutes); watch the GlofasService logs for the outcome.
   */
  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('glofas')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerGlofas() {
    void this.glofas
      .run()
      .then((n) => this.logger.log(`GloFAS manual run enriched ${n} stations`))
      .catch((e) =>
        this.logger.error(`GloFAS manual run failed: ${(e as Error).message}`),
      );
    return { started: true };
  }
}
