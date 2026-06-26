import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Station } from '../../stations/entities/station.entity';
import { DisasterEvent } from '../../events/entities/disaster-event.entity';
import { WeatherSnapshot } from '../../weather/entities/weather-snapshot.entity';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/**
 * Immutable record of a triggered alert. `thresholdValue` is COPIED (not
 * referenced) so history stays accurate after thresholds change; `reason`
 * explains actual vs threshold at trigger time. Maps to `alert_histories`.
 */
@Entity('alert_histories')
export class AlertHistory {
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

  @Column({ name: 'alert_level', type: 'int' })
  alertLevel: number;

  @Column({ name: 'triggered_at', type: 'timestamptz', default: () => 'now()' })
  triggeredAt: Date;

  @Column({
    name: 'actual_value',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  actualValue: number | null;

  @Column({
    name: 'threshold_value',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  thresholdValue: number | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'weather_snapshot_id', type: 'bigint', nullable: true })
  weatherSnapshotId: string | null;

  @ManyToOne(() => WeatherSnapshot)
  @JoinColumn({ name: 'weather_snapshot_id' })
  weatherSnapshot: WeatherSnapshot | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
