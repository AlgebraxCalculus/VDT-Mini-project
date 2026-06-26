import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { DisasterEvent } from './disaster-event.entity';
import { Station } from '../../stations/entities/station.entity';

/**
 * N-N event ↔ station, snapshotted after scoping so the map reuses it directly.
 * Composite PK (event_id, station_id). Maps to migration table `event_stations`.
 */
@Entity('event_stations')
export class EventStation {
  @PrimaryColumn({ name: 'event_id', type: 'bigint' })
  eventId: string;

  @PrimaryColumn({ name: 'station_id', type: 'int' })
  stationId: number;

  @ManyToOne(() => DisasterEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: DisasterEvent;

  @ManyToOne(() => Station, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'station_id' })
  station: Station;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}
