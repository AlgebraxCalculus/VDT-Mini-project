import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Station } from '../../stations/entities/station.entity';
import { DisasterEvent } from '../../events/entities/disaster-event.entity';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/** Sort key for risk severity. */
export enum RiskSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Risk pre-computed by the cron + Risk Engine (rainfall + river level + station
 * elevation vs threshold) over the 5–7 day timeline. Read APIs query this table
 * directly — they never compute inline. Maps to `station_risk_assessments`.
 */
@Entity('station_risk_assessments')
export class StationRiskAssessment {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'station_id', type: 'int' })
  stationId: number;

  @ManyToOne(() => Station, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'station_id' })
  station: Station;

  @Column({ name: 'event_id', type: 'bigint', nullable: true })
  eventId: string | null;

  @ManyToOne(() => DisasterEvent)
  @JoinColumn({ name: 'event_id' })
  event: DisasterEvent | null;

  @Column({ name: 'forecast_date', type: 'date' })
  forecastDate: string;

  @Column({
    name: 'predicted_water_level',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  predictedWaterLevel: number | null;

  @Column({
    name: 'threshold_value',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  thresholdValue: number | null;

  @Column({ name: 'is_exceeded', type: 'boolean', default: false })
  isExceeded: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  severity: RiskSeverity | null;

  @Column({
    name: 'risk_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  riskScore: number | null;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
