import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Station } from './station.entity';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/** Alert tiers: 1 = Chú ý, 2 = Cảnh báo, 3 = Nguy hiểm. */
export enum AlertLevel {
  WATCH = 1,
  WARNING = 2,
  DANGER = 3,
}

/**
 * Per-station multi-level flood threshold, versioned by `effectiveFrom`.
 * Changing thresholds re-triggers risk computation (event-driven).
 * Maps to migration table `flood_thresholds`.
 */
@Entity('flood_thresholds')
export class FloodThreshold {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'station_id', type: 'int' })
  stationId: number;

  @ManyToOne(() => Station, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'station_id' })
  station: Station;

  @Column({ name: 'alert_level', type: 'int' })
  alertLevel: AlertLevel;

  @Column({
    name: 'threshold_value',
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  thresholdValue: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({
    name: 'effective_from',
    type: 'timestamptz',
    default: () => 'now()',
  })
  effectiveFrom: Date;
}
