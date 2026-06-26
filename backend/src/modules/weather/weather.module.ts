import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from '../stations/entities/station.entity';
import { Province } from '../provinces/entities/province.entity';
import { WeatherForecast } from './entities/weather-forecast.entity';
import { WeatherSnapshot } from './entities/weather-snapshot.entity';
import { WEATHER_QUEUE, FORECAST_PROVIDERS, HEALTH_PROVIDERS } from './weather.constants';
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
import { OpenWeatherMapProvider } from './providers/open-weather-map.provider';
import { WeatherApiProvider } from './providers/weather-api.provider';
import { GdacsProvider } from './providers/gdacs.provider';
import { EonetProvider } from './providers/eonet.provider';

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
    OpenWeatherMapProvider,
    WeatherApiProvider,
    GdacsProvider,
    EonetProvider,
    // Ordered fallback chain: Open-Meteo → OWM → WeatherAPI.
    {
      provide: FORECAST_PROVIDERS,
      useFactory: (
        om: OpenMeteoProvider,
        owm: OpenWeatherMapProvider,
        wapi: WeatherApiProvider,
      ) => [om, owm, wapi],
      inject: [OpenMeteoProvider, OpenWeatherMapProvider, WeatherApiProvider],
    },
    // All sources are healthchecked (GDACS + EONET are disaster-only, not forecast).
    {
      provide: HEALTH_PROVIDERS,
      useFactory: (
        om: OpenMeteoProvider,
        owm: OpenWeatherMapProvider,
        wapi: WeatherApiProvider,
        gdacs: GdacsProvider,
        eonet: EonetProvider,
      ) => [om, owm, wapi, gdacs, eonet],
      inject: [
        OpenMeteoProvider,
        OpenWeatherMapProvider,
        WeatherApiProvider,
        GdacsProvider,
        EonetProvider,
      ],
    },
  ],
})
export class WeatherModule {}
