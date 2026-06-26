import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AccessTokenPayload } from '../auth/types/jwt-payload.interface';
import { TokenStoreService } from '../auth/token-store.service';
import { EventBusService } from '../../event-bus/event-bus.service';
import {
  EVENT_CHANNELS,
  RiskDeltaPayload,
} from '../../event-bus/event-bus.constants';
import {
  bboxToRooms,
  parseBbox,
  stationRoom,
  VIEWPORT_ROOM_PREFIX,
} from './viewport.util';

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Real-time gateway (API 44–47).
 *
 *   44 — connection: JWT access token verified in a Socket.IO middleware during
 *        the handshake (auth.token / Authorization header / query.token).
 *   45 — `subscribe:viewport`: join the tile rooms a bbox covers.
 *   47 — `unsubscribe:viewport`: leave all viewport rooms.
 *   46 — `risk:delta` (server→client): driven by the Redis event bus; each
 *        delta is fanned out to the one room the station sits in.
 *
 * Scaling: the Socket.IO redis-adapter (wired in main.ts) shares rooms across
 * instances. Deltas arrive on every instance via the bus, so we emit with
 * `.local` to reach only this instance's sockets — exactly-once cluster-wide.
 */
@WebSocketGateway({ cors: { origin: corsOrigins, credentials: true } })
export class RiskGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RiskGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
    private readonly eventBus: EventBusService,
  ) {}

  afterInit(server: Server): void {
    // API 44 — authenticate at the handshake. Rejecting here surfaces as a
    // `connect_error` on the client; the socket never opens.
    server.use((socket: Socket, next: (err?: Error) => void) => {
      void this.authenticate(socket)
        .then(() => next())
        .catch(() => next(new Error('unauthorized')));
    });

    // API 46 — bridge recomputed risk from the bus to viewport rooms.
    void this.eventBus.subscribe(EVENT_CHANNELS.RISK_DELTA, (payload) =>
      this.broadcastRiskDelta(payload),
    );
  }

  handleConnection(client: Socket): void {
    const user = client.data.user as AccessTokenPayload | undefined;
    this.logger.log(
      `ws connected sid=${client.id} user=${user?.sub ?? '?'}`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`ws disconnected sid=${client.id}`);
  }

  // API 45 — subscribe to the viewport's tile rooms.
  @SubscribeMessage('subscribe:viewport')
  onSubscribeViewport(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): { status: 'ok' | 'error'; rooms?: number; clamped?: boolean; message?: string } {
    const bbox = parseBbox(body);
    if (!bbox) {
      return { status: 'error', message: 'invalid bbox' };
    }

    // A viewport change re-subscribes: drop the old tiles before joining new ones.
    this.leaveViewportRooms(client);

    const { rooms, clamped } = bboxToRooms(bbox);
    if (rooms.length > 0) client.join(rooms);
    if (clamped) {
      this.logger.warn(
        `sid=${client.id} viewport too wide — room set clamped`,
      );
    }
    return { status: 'ok', rooms: rooms.length, clamped };
  }

  // API 47 — leave all viewport rooms.
  @SubscribeMessage('unsubscribe:viewport')
  onUnsubscribeViewport(
    @ConnectedSocket() client: Socket,
  ): { status: 'ok' } {
    this.leaveViewportRooms(client);
    return { status: 'ok' };
  }

  // ----------------------------------------------------------------------------
  // Internals.
  // ----------------------------------------------------------------------------

  /** Verify the access token from the handshake and stash the principal. */
  private async authenticate(socket: Socket): Promise<void> {
    const token = extractToken(socket);
    if (!token) throw new Error('missing token');

    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
    });
    if (payload.type !== 'access') throw new Error('wrong token type');
    if (!(await this.tokenStore.isTokenStillValid(payload.sub, payload.iat))) {
      throw new Error('token revoked');
    }

    socket.data.user = payload;
  }

  private leaveViewportRooms(client: Socket): void {
    for (const room of client.rooms) {
      if (room.startsWith(VIEWPORT_ROOM_PREFIX)) client.leave(room);
    }
  }

  /** Fan one delta out to the single room the station's coordinates fall in. */
  private broadcastRiskDelta(payload: RiskDeltaPayload): void {
    if (!this.server) return;
    const room = stationRoom(payload.lng, payload.lat);
    this.server.local.to(room).emit('risk:delta', {
      stationId: payload.stationId,
      riskStatus: payload.riskStatus,
      severity: payload.severity ?? null,
    });
  }
}

function stripBearer(value: string): string {
  return value.startsWith('Bearer ') ? value.slice(7) : value;
}

function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  if (auth?.token) return stripBearer(auth.token);

  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string') return stripBearer(header);

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string') return stripBearer(queryToken);

  return null;
}
