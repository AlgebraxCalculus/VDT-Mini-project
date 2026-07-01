import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { dataSourceOptions } from './database/data-source';
import { AppController } from './app.controller';
import { RedisModule } from './redis/redis.module';
import { EventBusModule } from './event-bus/event-bus.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { UsersModule } from './modules/users/users.module';
import { StationsModule } from './modules/stations/stations.module';
import { EventsModule } from './modules/events/events.module';
import { ProvincesModule } from './modules/provinces/provinces.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MapModule } from './modules/map/map.module';
import { WeatherModule } from './modules/weather/weather.module';
import { RiskModule } from './modules/risk/risk.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    // Global infra: Redis client + internal Pub/Sub event bus.
    RedisModule,
    EventBusModule,
    // BullMQ (weather ingestion jobs) — own Redis connection, not RedisService.
    // maxRetriesPerRequest must be null for BullMQ's blocking connections.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: parseInt(config.get<string>('REDIS_PORT') ?? '6379', 10),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: parseInt(config.get<string>('REDIS_DB') ?? '0', 10),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    // Cron: hourly weather ingestion + periodic source healthchecks.
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    StationsModule,
    EventsModule,
    ProvincesModule,
    RealtimeModule,
    MapModule,
    WeatherModule,
    RiskModule,
    ReportsModule,
    SystemModule,
  ],
  controllers: [AppController],
  providers: [
    // Global auth: every route requires a valid JWT unless marked @Public().
    // Registration order matters — authentication runs before authorization.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global RBAC: routes/classes decorated with @Roles(...) are enforced here.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
