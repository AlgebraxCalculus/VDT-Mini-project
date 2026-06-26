import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DisasterEvent } from './disaster-event.entity';
import { Province } from '../../provinces/entities/province.entity';
import { GeoPolygon } from '../../../common/types/geometry.types';

/**
 * N-N event ↔ province. `affectedArea` (GIST-indexed) is the polygon sent to the
 * client to draw the impact boundary; frozen at scope-assignment time so the map
 * redraws without re-running spatial joins. Maps to `event_provinces`.
 */
@Entity('event_provinces')
export class EventProvince {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'event_id', type: 'bigint' })
  eventId: string;

  @ManyToOne(() => DisasterEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: DisasterEvent;

  @Column({ name: 'province_id', type: 'int' })
  provinceId: number;

  @ManyToOne(() => Province)
  @JoinColumn({ name: 'province_id' })
  province: Province;

  @Column({
    name: 'affected_area',
    type: 'geometry',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  affectedArea: GeoPolygon | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
