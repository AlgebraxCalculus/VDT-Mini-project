import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FloodThreshold } from './entities/flood-threshold.entity';
import { Station } from './entities/station.entity';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { STATION_IMPORT_QUEUE } from './import/station-import.constants';
import { StationImportService } from './import/station-import.service';
import { StationImportProcessor } from './import/station-import.processor';
import { ProvincesModule } from '../provinces/provinces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Station, FloodThreshold]),
    // ProvinceResolverService: auto-assign / auto-create the province for a
    // station coordinate (incl. geocoding when it's outside the seeded provinces).
    ProvincesModule,
    // Async batch import (API 18). attempts: 1 — the job is non-idempotent
    // (earlier batches commit), so a retry must not re-process committed rows.
    BullModule.registerQueue({
      name: STATION_IMPORT_QUEUE,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    }),
  ],
  controllers: [StationsController],
  providers: [StationsService, StationImportService, StationImportProcessor],
  exports: [StationsService],
})
export class StationsModule {}
