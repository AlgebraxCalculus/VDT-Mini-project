import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

/**
 * Tracks refresh-token validity and access-token invalidation cut-offs, backed
 * by Redis so the state is shared across every API/WebSocket instance.
 *
 * Keys (all expire after the refresh TTL — nothing outlives the longest token):
 *   - refresh:<jti>        -> userId         (rotation whitelist; one-time-use)
 *   - user:refresh:<uid>   -> SET of jtis    (so we can revoke all of a user's)
 *   - user:epoch:<uid>     -> unix seconds   (tokens with iat < epoch are dead)
 *
 * The public API mirrors the previous in-memory version but is now async (Redis
 * I/O). Bumping a user's epoch instantly kills all their live access + refresh
 * tokens — used on logout, role change, deactivate, and delete.
 */
@Injectable()
export class TokenStoreService {
  /** Refresh TTL in seconds — the expiry applied to every key here. */
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = parseDurationSeconds(
      config.get<string>('JWT_REFRESH_TTL') ?? '7d',
    );
  }

  private refreshKey(jti: string): string {
    return `refresh:${jti}`;
  }

  private userRefreshKey(userId: number): string {
    return `user:refresh:${userId}`;
  }

  private epochKey(userId: number): string {
    return `user:epoch:${userId}`;
  }

  /** Register a freshly issued refresh token so it can later be rotated/revoked. */
  async saveRefreshToken(jti: string, userId: number): Promise<void> {
    const userKey = this.userRefreshKey(userId);
    await this.redis.client
      .multi()
      .set(this.refreshKey(jti), String(userId), 'EX', this.ttlSeconds)
      .sadd(userKey, jti)
      .expire(userKey, this.ttlSeconds)
      .exec();
  }

  /** A refresh token is usable only if its jti is still whitelisted for the user. */
  async isRefreshTokenValid(jti: string, userId: number): Promise<boolean> {
    const owner = await this.redis.client.get(this.refreshKey(jti));
    return owner === String(userId);
  }

  /** Revoke a single refresh token (used during rotation and on logout). */
  async revokeRefreshToken(jti: string): Promise<void> {
    const owner = await this.redis.client.get(this.refreshKey(jti));
    const pipeline = this.redis.client.multi().del(this.refreshKey(jti));
    if (owner !== null) {
      pipeline.srem(this.userRefreshKey(Number(owner)), jti);
    }
    await pipeline.exec();
  }

  /**
   * Invalidate every token currently held by a user (logout-everywhere / role
   * change). Sets the epoch to "now" and drops all their refresh tokens.
   */
  async invalidateUser(userId: number): Promise<void> {
    const userKey = this.userRefreshKey(userId);
    const jtis = await this.redis.client.smembers(userKey);

    const pipeline = this.redis.client
      .multi()
      .set(this.epochKey(userId), nowSeconds().toString(), 'EX', this.ttlSeconds)
      .del(userKey);
    for (const jti of jtis) {
      pipeline.del(this.refreshKey(jti));
    }
    await pipeline.exec();
  }

  /**
   * True if a token issued at `iat` is still honored (not pre-dating the user's
   * last invalidation cut-off). Used by JwtStrategy on every authenticated call
   * and by the WebSocket handshake.
   */
  async isTokenStillValid(userId: number, iat?: number): Promise<boolean> {
    const cutoff = await this.redis.client.get(this.epochKey(userId));
    if (cutoff === null) return true;
    if (iat === undefined) return false;
    return iat >= Number(cutoff);
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Parse a JWT-style duration ("900s", "15m", "1h", "7d", or a bare number of
 * seconds) into seconds. Falls back to 7 days on anything unrecognized.
 */
export function parseDurationSeconds(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)\s*([smhd]?)$/i.exec(trimmed);
  if (!match) return 7 * 24 * 60 * 60;
  const amount = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 24 * 60 * 60;
    case 's':
    case '':
    default:
      return amount;
  }
}
