import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';

/**
 * Global access to the internal Redis Pub/Sub event bus. Producers (stations,
 * events, weather) inject {@link EventBusService} to publish; consumers (the
 * future Risk Engine, the realtime gateway) inject it to subscribe — no need to
 * import this module each time. Relies on the global RedisModule.
 */
@Global()
@Module({
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
