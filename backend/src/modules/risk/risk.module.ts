import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationRiskAssessment } from './entities/station-risk-assessment.entity';
import { AlertHistory } from './entities/alert-history.entity';
import { Station } from '../stations/entities/station.entity';
import { Province } from '../provinces/entities/province.entity';
import { FloodThreshold } from '../stations/entities/flood-threshold.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { RiskEngineService } from './risk-engine.service';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { ForecastsController } from './forecasts.controller';
import { AlertHistoryController } from './alert-history.controller';

/**
 * Group G — Risk Engine + risk/forecast read APIs (36–39).
 *
 * - {@link RiskEngineService} is the event-bus consumer (the piece the backbone
 *   was waiting for): it computes the pre-computed tables and emits RISK_DELTA.
 *   It depends on {@link RealtimeModule}'s RealtimeService for the producer side.
 * - {@link RiskService} backs the read endpoints, querying only what the engine
 *   wrote. RedisModule + EventBusModule are global, so no import needed here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StationRiskAssessment,
      AlertHistory,
      Station,
      Province,
      FloodThreshold,
    ]),
    RealtimeModule,
  ],
  controllers: [RiskController, ForecastsController, AlertHistoryController],
  providers: [RiskEngineService, RiskService],
  exports: [RiskEngineService],
})
export class RiskModule {}
