import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * External data source codes (forecast priority: OpenMeteo → OWM → WeatherAPI).
 * GDACS and EONET are disaster-event sources, not forecast providers — EONET is a
 * directly-reachable, multi-hazard alternative to GDACS (which is TCP-blocked from
 * some networks).
 */
export enum WeatherSource {
  OPEN_METEO = 'OpenMeteo',
  GDACS = 'GDACS',
  EONET = 'EONET',
  OPEN_WEATHER_MAP = 'OpenWeatherMap',
  WEATHER_API = 'WeatherAPI',
}

export enum SnapshotTrigger {
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
}

/**
 * Metadata for one external forecast refresh (on-demand or cron). The
 * normalized payload lives in `rawPayload`; the time-series is exploded into
 * `weather_forecasts`. Maps to migration table `weather_snapshots`.
 */
@Entity('weather_snapshots')
export class WeatherSnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'source_code', type: 'varchar', length: 50 })
  sourceCode: WeatherSource;

  @Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
  fetchedAt: Date;

  @Column({ name: 'trigger_type', type: 'varchar', length: 20 })
  triggerType: SnapshotTrigger;

  @Column({ name: 'triggered_by', type: 'int', nullable: true })
  triggeredBy: number | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'triggered_by' })
  triggeredByUser: User | null;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  status: string | null;
}
