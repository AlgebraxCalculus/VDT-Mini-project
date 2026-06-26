import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { InternalTokenGuard } from './guards/internal-token.guard';
import { WeatherService } from './weather.service';

/**
 * API 34 — scheduler-only ingestion trigger. Not called by browser clients:
 * the route is @Public() (bypasses the global JWT guard) and gated solely by
 * the X-Internal-Token shared secret. The cron service calls the same enqueue
 * path directly.
 */
@Controller('internal/weather')
export class WeatherInternalController {
  constructor(private readonly weatherService: WeatherService) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  ingest() {
    return this.weatherService.enqueueIngest();
  }
}
