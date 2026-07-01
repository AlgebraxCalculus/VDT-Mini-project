import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapService } from './map.service';

/**
 * Group E — Map / GIS by viewport BBOX (APIs 27–30). All queries are raw PostGIS
 * via the globally-provided DataSource (no entities of its own — it reads stations,
 * events, weather, and risk tables across modules), so no TypeOrmModule.forFeature.
 */
@Module({
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
