import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions, Server } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Socket.IO adapter backed by Redis Pub/Sub so rooms and broadcasts work across
 * multiple API instances (the design's horizontal-scaling requirement). Uses two
 * dedicated Redis connections (pub + sub) cloned from the shared client.
 *
 * Wire it in main.ts before `app.listen()`:
 *   const adapter = new RedisIoAdapter(app);
 *   await adapter.connectToRedis(app.get(RedisService));
 *   app.useWebSocketAdapter(adapter);
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(redis: RedisService): void {
    const pubClient = redis.duplicate('socketio-pub');
    const subClient = redis.duplicate('socketio-sub');
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
