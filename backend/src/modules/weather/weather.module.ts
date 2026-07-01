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
 * Group F — third-party weather integration (APIs 31–35): the BullMQ 'weather' queue
 * (3× backoff retry), the ordered provider collections, and the worker.
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
    // Forecast fallback chain: Open-Meteo → MET Norway → WeatherAPI. MET Norway is
    // second: keyless + reachable where the others are blocked.
    {
      provide: FORECAST_PROVIDERS,
      useFactory: (
        om: OpenMeteoProvider,
        met: MetNorwayProvider,
        wapi: WeatherApiProvider,
      ) => [om, met, wapi],
      inject: [OpenMeteoProvider, MetNorwayProvider, WeatherApiProvider],
    },
    // Disaster fallback chain: GDACS → ReliefWeb → EONET (ReliefWeb skipped until
    // RELIEFWEB_APPNAME is set, so effectively GDACS → EONET).
    {
      provide: DISASTER_PROVIDERS,
      useFactory: (
        gdacs: GdacsProvider,
        reliefweb: ReliefWebProvider,
        eonet: EonetProvider,
      ) => [gdacs, reliefweb, eonet],
      inject: [GdacsProvider, ReliefWebProvider, EonetProvider],
    },
    // All sources healthchecked (API 35): forecast + disaster + GloFAS.
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
  // DISASTER_PROVIDERS is reused (and reordered) by Group D's event ingestion;
  // GdacsProvider stays exported for backward compatibility.
  exports: [GdacsProvider, DISASTER_PROVIDERS],
})
export class WeatherModule {}
