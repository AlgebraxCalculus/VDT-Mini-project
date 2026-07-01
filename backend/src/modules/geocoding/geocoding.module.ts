import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

/**
 * Reverse-geocoding (OSM Nominatim). Provides {@link GeocodingService} to any
 * module that needs coordinate → admin-name/polygon resolution (stations,
 * province auto-create). ConfigService + RedisService come from global modules.
 */
@Module({
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
