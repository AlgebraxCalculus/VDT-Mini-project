import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenModule } from '../auth/token.module';
import { RealtimeService } from './realtime.service';
import { RiskGateway } from './risk.gateway';

/**
 * Real-time layer (API 44–47). Hosts the Socket.IO gateway and the producer-side
 * {@link RealtimeService}.
 *
 * - JwtModule.register({}) — verify access tokens at the WS handshake with the
 *   access secret passed explicitly (same pattern as AuthModule).
 * - TokenModule — the gateway honors the same invalidation epoch as REST.
 * - RedisModule / EventBusModule are global (no import needed).
 *
 * Exports RealtimeService so future producers (e.g. the Risk Engine) can emit
 * deltas without depending on the gateway directly.
 */
@Module({
  imports: [TokenModule, JwtModule.register({})],
  providers: [RiskGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
