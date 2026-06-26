import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisService } from './redis/redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Close Redis (and other lifecycle) connections cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Back Socket.IO with the Redis adapter so rooms/broadcasts span instances.
  const redisIoAdapter = new RedisIoAdapter(app);
  redisIoAdapter.connectToRedis(app.get(RedisService));
  app.useWebSocketAdapter(redisIoAdapter);

  // Allow the Vite frontend (and any configured origins) to call the API from
  // the browser. CORS_ORIGINS is a comma-separated allowlist; defaults to the
  // local Vite dev server. Credentials are enabled for future cookie use.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Global DTO validation: strip unknown props, reject extras, and transform
  // payloads/query strings into typed DTO instances (needed for @Type()).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const port = parseInt(process.env.API_PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on http://0.0.0.0:${port}`);
}
bootstrap();
