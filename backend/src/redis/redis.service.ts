import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

/**
 * Owns the shared ioredis command client and hands out dedicated connections
 * for the things that need their own socket:
 *   - the internal Pub/Sub event bus (a subscriber connection can't run normal
 *     commands, so it needs a separate client);
 *   - the Socket.IO redis-adapter (one pub + one sub client).
 *
 * All connections created here are tracked and closed on shutdown.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /** Shared client for commands + publishing (cache, token store, event bus). */
  readonly client: Redis;

  /** Extra connections (subscribers, adapter) we created and must close. */
  private readonly extraConnections: Redis[] = [];

  constructor(private readonly config: ConfigService) {
    this.client = this.create('main');
  }

  /**
   * A dedicated connection cloned from the main client's options. Use for
   * Pub/Sub subscribers and the Socket.IO adapter — never for general commands
   * once it has entered subscriber mode.
   */
  duplicate(label: string): Redis {
    const conn = this.create(label);
    this.extraConnections.push(conn);
    return conn;
  }

  private create(label: string): Redis {
    const options: RedisOptions = {
      host: this.config.get<string>('REDIS_HOST') ?? 'localhost',
      port: parseInt(this.config.get<string>('REDIS_PORT') ?? '6379', 10),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: parseInt(this.config.get<string>('REDIS_DB') ?? '0', 10),
      // Keep retrying instead of crashing the process if Redis blips.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    };

    const conn = new Redis(options);
    conn.on('error', (err) =>
      this.logger.error(`redis[${label}] error: ${err.message}`),
    );
    conn.on('connect', () => this.logger.log(`redis[${label}] connected`));
    return conn;
  }

  async onModuleDestroy(): Promise<void> {
    const all = [this.client, ...this.extraConnections];
    await Promise.all(
      all.map((c) => c.quit().catch(() => c.disconnect())),
    );
  }
}
