import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Disaster type catalogue. Maps to migration table `disaster_types`. */
@Entity('disaster_types')
export class DisasterType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 30, unique: true })
  code: string; // e.g. STORM, FLOOD

  @Column({ type: 'varchar', length: 100 })
  name: string;
}
