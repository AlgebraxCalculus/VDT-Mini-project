import { Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { InternalTokenGuard } from '../weather/guards/internal-token.guard';
import { EventIngestionService } from './ingestion/event-ingestion.service';

/**
 * Scheduler-only trigger for one disaster-ingest pass (same work as the
 * DISASTER_CRON job). Not for browser clients: @Public() bypasses the global JWT
 * guard and the route is gated solely by the X-Internal-Token shared secret.
 * Useful for forcing a sync on demand / debugging the GDACS pipeline.
 */
@Controller('internal/events')
export class EventsInternalController {
  constructor(private readonly ingestion: EventIngestionService) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('ingest')
  ingest() {
    // Bounded work (a handful of active hazards) — await and return the summary.
    return this.ingestion.run();
  }
}
