import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from '../stations/entities/station.entity';
import { Province } from '../provinces/entities/province.entity';
import { WeatherForecast } from './entities/weather-forecast.entity';
import { WeatherSnapshot } from './entities/weather-snapshot.entity';
import {
  WEATHER_QUEUE,
  FORECAST_PROVIDERS,
  DISASTER_PROVIDERS,
  HEALTH_PROVIDERS,
} from './weather.constants';
import { WeatherController } from './weather.controller';
import { WeatherInternalController } from './weather-internal.controller';
import { IntegrationsController } from './integrations.controller';
import { WeatherService } from './weather.service';
import { WeatherIngestionService } from './weather-ingestion.service';
import { WeatherCronService } from './weather-cron.service';
import { WeatherProcessor } from './weather.processor';
import { HealthMonitorService } from './health-monitor.service';
import { InternalTokenGuard } from './guards/internal-token.guard';
import { OpenMeteoProvider } from './providers/open-meteo.provider';
import { WeatherApiProvider } from './providers/weather-api.provider';
import { GdacsProvider } from './providers/gdacs.provider';
import { EonetProvider } from './providers/eonet.provider';
import { MetNorwayProvider } from './providers/met-norway.provider';
import { ReliefWebProvider } from './providers/reliefweb.provider';
import { GlofasProvider } from './providers/glofas.provider';
import { GlofasService } from './glofas.service';

/**
 * Group F — third-party weather integration (APIs 31–35). Registers the BullMQ
 * 'weather' queue (jobs retry 3× with backoff), the forecast/health provider
 * collections (ordered for the fallback chain), and the in-process worker.
 * Relies on the global RedisModule + EventBusModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WeatherSnapshot,
      WeatherForecast,
      Station,
      Province,
    ]),
    BullModule.registerQueue({
      name: WEATHER_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  controllers: [
    WeatherController,
    WeatherInternalController,
    IntegrationsController,
  ],
  providers: [
    WeatherService,
    WeatherIngestionService,
    WeatherCronService,
    WeatherProcessor,
    HealthMonitorService,
    InternalTokenGuard,
    OpenMeteoProvider,
    WeatherApiProvider,
    GdacsProvider,
    EonetProvider,
    MetNorwayProvider,
    ReliefWebProvider,
    GlofasProvider,
    GlofasService,
    // Ordered forecast fallback chain: Open-Meteo → MET Norway → WeatherAPI.
    // MET Norway sits second — keyless + reachable where the others are blocked,
    // so it catches when Open-Meteo is rate-limited/down before falling to WeatherAPI.
    {
      provide: FORECAST_PROVIDERS,
      useFactory: (
        om: OpenMeteoProvider,
        met: MetNorwayProvider,
        wapi: WeatherApiProvider,
      ) => [om, met, wapi],
      inject: [OpenMeteoProvider, MetNorwayProvider, WeatherApiProvider],
    },
    // Ordered disaster fallback chain: GDACS → ReliefWeb → EONET. ReliefWeb is
    // skipped (isConfigured=false) until RELIEFWEB_APPNAME is set, so the chain
    // currently falls GDACS → EONET in practice.
    {
      provide: DISASTER_PROVIDERS,
      useFactory: (
        gdacs: GdacsProvider,
        reliefweb: ReliefWebProvider,
        eonet: EonetProvider,
      ) => [gdacs, reliefweb, eonet],
      inject: [GdacsProvider, ReliefWebProvider, EonetProvider],
    },
    // All sources are healthchecked (API 35): forecast chain, then disaster chain,
    // then GloFAS (river). GloFAS being DOWN is non-fatal — it runs on its own cron.
    {
      provide: HEALTH_PROVIDERS,
      useFactory: (
        om: OpenMeteoProvider,
        met: MetNorwayProvider,
        wapi: WeatherApiProvider,
        gdacs: GdacsProvider,
        reliefweb: ReliefWebProvider,
        eonet: EonetProvider,
        glofas: GlofasProvider,
      ) => [om, met, wapi, gdacs, reliefweb, eonet, glofas],
      inject: [
        OpenMeteoProvider,
        MetNorwayProvider,
        WeatherApiProvider,
        GdacsProvider,
        ReliefWebProvider,
        EonetProvider,
        GlofasProvider,
      ],
    },
  ],
})
export class WeatherModule {}
