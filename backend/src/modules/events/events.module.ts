import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DisasterEvent } from './entities/disaster-event.entity';
import { DisasterType } from './entities/disaster-type.entity';
import { EventsController } from './events.controller';
import { EventsInternalController } from './events-internal.controller';
import { EventsService } from './events.service';
import { EventIngestionService } from './ingestion/event-ingestion.service';
import { InternalTokenGuard } from '../weather/guards/internal-token.guard';
import { WeatherModule } from '../weather/weather.module';

/**
 * Group D — disaster events. Manual creation was removed; events are tracked
 * automatically by {@link EventIngestionService} from the disaster fallback chain
 * GDACS → EONET → ReliefWeb (it injects the `DISASTER_PROVIDERS` collection
 * exported by {@link WeatherModule}) and writes the N-N scope via raw PostGIS. The
 * internal controller exposes a scheduler-only manual trigger.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DisasterEvent, DisasterType]),
    WeatherModule,
  ],
  controllers: [EventsController, EventsInternalController],
  providers: [EventsService, EventIngestionService, InternalTokenGuard],
  exports: [EventsService],
})
export class EventsModule {}
