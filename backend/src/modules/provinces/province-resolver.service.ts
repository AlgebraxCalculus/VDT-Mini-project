import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GeocodingService } from '../geocoding/geocoding.service';

/**
 * Resolve a coordinate to a `province_id`, creating a province when the point falls
 * outside every existing one. Attempts, in order: (1) ST_Contains against existing
 * boundaries; (2) reverse-geocode + reuse a same-named province; (3) create one from
 * the geocoded admin polygon. Returns `null` only when the point can't be geocoded
 * to any province (open sea / outside coverage).
 */
@Injectable()
export class ProvinceResolverService {
  private readonly logger = new Logger(ProvinceResolverService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly geocoding: GeocodingService,
  ) {}

  /** Resolve (and if needed create) the province for a coordinate. */
  async resolveProvinceId(lat: number, lng: number): Promise<number | null> {
    const inside = await this.containingProvinceId(lng, lat);
    if (inside != null) return inside;

    const geo = await this.geocoding.reverse(lat, lng);
    if (!geo?.province) return null;

    return this.findOrCreateProvince(geo.province, geo.polygon, lng, lat);
  }

  /** Existing province whose boundary contains the point (nearest-centroid tiebreak). */
  private async containingProvinceId(
    lng: number,
    lat: number,
  ): Promise<number | null> {
    const rows = await this.dataSource.query<{ id: number }[]>(
      `SELECT id FROM provinces
        WHERE boundary IS NOT NULL
          AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        ORDER BY ST_Distance(centroid, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 1`,
      [lng, lat],
    );
    return rows[0]?.id ?? null;
  }

  /** Reuse a same-named province, else INSERT one with the geocoded polygon. */
  private async findOrCreateProvince(
    name: string,
    polygon: object | null,
    lng: number,
    lat: number,
  ): Promise<number | null> {
    const existing = await this.dataSource.query<{ id: number }[]>(
      `SELECT id FROM provinces WHERE lower(name) = lower($1) LIMIT 1`,
      [name],
    );
    if (existing[0]) return existing[0].id;

    const code = await this.uniqueCode(name);
    const geojson = polygon ? JSON.stringify(polygon) : null;

    // boundary = geocoded polygon (forced MultiPolygon); centroid = its centroid,
    // or the point itself when no polygon was found.
    const inserted = await this.dataSource.query<{ id: number }[]>(
      `INSERT INTO provinces (code, name, boundary, centroid)
       VALUES (
         $1, $2,
         CASE WHEN $3::text IS NULL THEN NULL
              ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) END,
         CASE WHEN $3::text IS NULL THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)
              ELSE ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) END
       )
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [code, name, geojson, lng, lat],
    );
    if (inserted[0]) {
      this.logger.log(`Created province "${name}" (code ${code}, id ${inserted[0].id})`);
      return inserted[0].id;
    }

    // Lost an ON CONFLICT race — fetch the row the other writer created.
    const again = await this.dataSource.query<{ id: number }[]>(
      `SELECT id FROM provinces WHERE code = $1 LIMIT 1`,
      [code],
    );
    return again[0]?.id ?? null;
  }

  /** Diacritic-stripped uppercase slug of the name, suffixed until unique (≤20). */
  private async uniqueCode(name: string): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // strip combining diacritics
        .replace(/[đĐ]/g, 'D') // đ / Đ → D
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 16) || 'PROV';

    let code = base;
    let i = 1;
    // Probe for a free code — names rarely collide.
    while (await this.codeExists(code)) {
      const suffix = String(i++);
      code = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    }
    return code;
  }

  private async codeExists(code: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ one: number }[]>(
      `SELECT 1 AS one FROM provinces WHERE code = $1 LIMIT 1`,
      [code],
    );
    return rows.length > 0;
  }
}
