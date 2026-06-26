import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DisasterType } from './disaster-type.entity';
import { User } from '../../users/entities/user.entity';

/** Event lifecycle state machine. CLOSED is terminal — locks all edits. */
export enum EventStatus {
  ONGOING = 'ONGOING',
  CLOSED = 'CLOSED',
}

/**
 * Disaster event (bão/lũ). `id` is BIGINT → typed as string to avoid 2^53
 * precision loss. Maps to migration table `disaster_events`.
 */
@Entity('disaster_events')
export class DisasterEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'event_code', type: 'varchar', length: 50, unique: true })
  eventCode: string;

  @Column({ name: 'disaster_type_id', type: 'int' })
  disasterTypeId: number;

  @ManyToOne(() => DisasterType)
  @JoinColumn({ name: 'disaster_type_id' })
  disasterType: DisasterType;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  status: EventStatus;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz', nullable: true })
  endTime: Date | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
