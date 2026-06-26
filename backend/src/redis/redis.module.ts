import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Global Redis access. Provides {@link RedisService} (the shared command client +
 * a factory for dedicated Pub/Sub / adapter connections) everywhere, plus the
 * raw {@link REDIS_CLIENT} token for the few places that want the client itself.
 *
 * Marked @Global so feature modules (auth token store, event bus, realtime
 * gateway) can inject it without importing this module each time.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      useFactory: (redis: RedisService) => redis.client,
      inject: [RedisService],
    },
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
