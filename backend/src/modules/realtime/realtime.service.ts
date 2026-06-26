import { Injectable } from '@nestjs/common';
import { EventBusService } from '../../event-bus/event-bus.service';
import {
  EVENT_CHANNELS,
  RiskDeltaPayload,
} from '../../event-bus/event-bus.constants';

/**
 * Producer side of the real-time risk channel. The Risk Engine (future) — or any
 * server-side flow that recomputes a station's risk — calls {@link emitRiskDelta}
 * to publish a delta onto the Redis event bus. {@link RiskGateway} consumes that
 * channel and fans the delta out to the matching viewport rooms.
 *
 * Routing through the bus (rather than emitting to sockets directly) keeps the
 * producer decoupled from the gateway and works across instances.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly eventBus: EventBusService) {}

  /** Publish one station's recomputed risk for delivery to subscribed clients. */
  async emitRiskDelta(payload: RiskDeltaPayload): Promise<void> {
    await this.eventBus.publish(EVENT_CHANNELS.RISK_DELTA, payload);
  }
}
