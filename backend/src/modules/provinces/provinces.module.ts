import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Province } from './entities/province.entity';
import { ProvincesController } from './provinces.controller';
import { ProvincesService } from './provinces.service';
import { ProvinceResolverService } from './province-resolver.service';
import { GeocodingModule } from '../geocoding/geocoding.module';

@Module({
  imports: [TypeOrmModule.forFeature([Province]), GeocodingModule],
  controllers: [ProvincesController],
  providers: [ProvincesService, ProvinceResolverService],
  exports: [ProvincesService, ProvinceResolverService],
})
export class ProvincesModule {}
