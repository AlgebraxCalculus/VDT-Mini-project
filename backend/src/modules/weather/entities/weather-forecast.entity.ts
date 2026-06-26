import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WeatherSnapshot } from './weather-snapshot.entity';
import { Station } from '../../stations/entities/station.entity';
import { Province } from '../../provinces/entities/province.entity';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/**
 * 5–7 day forecast time-series for a station OR a province (exactly one of
 * `stationId`/`provinceId` is set). `rainfall` and `riverWaterLevel` are the
 * Risk Engine inputs. Maps to migration table `weather_forecasts`.
 */
@Entity('weather_forecasts')
export class WeatherForecast {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'snapshot_id', type: 'bigint' })
  snapshotId: string;

  @ManyToOne(() => WeatherSnapshot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: WeatherSnapshot;

  @Column({ name: 'station_id', type: 'int', nullable: true })
  stationId: number | null;

  @ManyToOne(() => Station)
  @JoinColumn({ name: 'station_id' })
  station: Station | null;

  @Column({ name: 'province_id', type: 'int', nullable: true })
  provinceId: number | null;

  @ManyToOne(() => Province)
  @JoinColumn({ name: 'province_id' })
  province: Province | null;

  @Column({ name: 'forecast_time', type: 'timestamptz' })
  forecastTime: Date;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  temperature: number | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  rainfall: number | null;

  @Column({
    name: 'wind_speed',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  windSpeed: number | null;

  @Column({
    name: 'wind_direction',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  windDirection: number | null;

  @Column({
    name: 'river_water_level',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  riverWaterLevel: number | null;
}
