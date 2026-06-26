/**
 * Minimal GeoJSON geometry types for PostGIS columns (SRID 4326).
 *
 * Kept dependency-free (no `@types/geojson`) on purpose — these are the only
 * shapes the schema uses: station points, province boundaries, event polygons.
 * Coordinates are always [longitude, latitude] per the GeoJSON spec.
 */

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoPolygon {
  type: 'Polygon';
  /** Array of linear rings; ring[0] is the exterior, the rest are holes. */
  coordinates: number[][][];
}

export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
