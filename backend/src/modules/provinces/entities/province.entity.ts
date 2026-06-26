import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { GeoMultiPolygon, GeoPoint } from '../../../common/types/geometry.types';

/**
 * Admin boundary (Tỉnh/Thành). `boundary` drives point-in-polygon
 * auto-assignment of stations via ST_Contains; both geometry columns have GIST
 * indexes (see migration). Maps to migration table `provinces`.
 */
@Entity('provinces')
export class Province {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  // Whole-province MultiPolygon — large WKB. Used only by raw PostGIS in
  // ST_Contains province auto-assignment, never serialized to clients.
  // `select: false` keeps it out of every ORM read (e.g. the station list joins
  // province for its name; without this it would ship a full polygon per row).
  @Column({
    type: 'geometry',
    spatialFeatureType: 'MultiPolygon',
    srid: 4326,
    nullable: true,
    select: false,
  })
  boundary: GeoMultiPolygon | null;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
    select: false,
  })
  centroid: GeoPoint | null;
}
