import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../redis/redis.service';
import {
  EventChannel,
  EventPayloadMap,
} from './event-bus.constants';

type Handler<C extends EventChannel> = (
  payload: EventPayloadMap[C],
) => void | Promise<void>;

/**
 * Thin, typed wrapper over Redis Pub/Sub for the internal event bus. Publishing
 * uses the shared command client; subscribing uses one dedicated connection
 * (Redis requires a separate socket in subscriber mode). Handlers are
 * multiplexed in-process per channel, so many subscribers share one Redis
 * subscription.
 *
 * Cross-instance by design: an event published on any API instance is delivered
 * to handlers on every instance subscribed to that channel.
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Set<Handler<EventChannel>>>();

  // The subscriber connection is created at construction (not in onModuleInit)
  // so it's ready before any consumer's gateway `afterInit` runs — Nest does not
  // guarantee provider onModuleInit ordering vs. gateway afterInit across modules.
  constructor(private readonly redis: RedisService) {
    this.subscriber = this.redis.duplicate('event-bus-sub');
    this.subscriber.on('message', (channel: string, message: string) => {
      void this.dispatch(channel, message);
    });
  }

  /** Publish a typed payload to a channel (fire-and-forget at the call site). */
  async publish<C extends EventChannel>(
    channel: C,
    payload: EventPayloadMap[C],
  ): Promise<void> {
    await this.redis.client.publish(channel, JSON.stringify(payload));
  }

  /** Register a handler for a channel; subscribes to Redis on first handler. */
  async subscribe<C extends EventChannel>(
    channel: C,
    handler: Handler<C>,
  ): Promise<void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler as Handler<EventChannel>);
  }

  private async dispatch(channel: string, message: string): Promise<void> {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      this.logger.warn(`dropping malformed message on ${channel}`);
      return;
    }

    for (const handler of set) {
      try {
        await handler(payload as EventPayloadMap[EventChannel]);
      } catch (err) {
        this.logger.error(
          `handler for ${channel} threw: ${(err as Error).message}`,
        );
      }
    }
  }
}
