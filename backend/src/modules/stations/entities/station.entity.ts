import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Province } from '../../provinces/entities/province.entity';
import { GeoPoint } from '../../../common/types/geometry.types';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/** Real-time risk state cached on the station row (updated by the Risk Engine). */
export enum RiskStatus {
  NORMAL = 'NORMAL',
  WATCH = 'WATCH',
  WARNING = 'WARNING',
  DANGER = 'DANGER',
}

/**
 * Telecom station. `geom` (GIST-indexed) powers viewport BBOX queries
 * (ST_MakeEnvelope/ST_Contains). Deletes are soft (`isDeleted`/`deletedAt`) to
 * keep report history intact. Maps to migration table `stations`.
 */
@Entity('stations')
export class Station {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'station_code', type: 'varchar', length: 50, unique: true })
  stationCode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: decimalTransformer,
  })
  latitude: number | null;

  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: decimalTransformer,
  })
  longitude: number | null;

  // GIST-indexed Point for spatial/viewport queries (raw SQL: ST_MakeEnvelope /
  // ST_Contains). Never returned by ORM reads — `select: false` keeps the WKB
  // out of list/detail payloads (it would bloat responses at 10k+ rows). The
  // latitude/longitude decimals above are the client-facing coordinates.
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
    select: false,
  })
  geom: GeoPoint | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  elevation: number | null;

  @Column({ name: 'province_id', type: 'int', nullable: true })
  provinceId: number | null;

  @ManyToOne(() => Province)
  @JoinColumn({ name: 'province_id' })
  province: Province | null;

  @Column({ name: 'risk_status', type: 'varchar', length: 20, nullable: true })
  riskStatus: RiskStatus | null;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
