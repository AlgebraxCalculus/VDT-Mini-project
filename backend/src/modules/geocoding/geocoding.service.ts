import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { GeoMultiPolygon, GeoPolygon } from '../../common/types/geometry.types';

/** Result of a reverse-geocode lookup (Vietnamese admin names, `null` over sea). */
export interface GeocodeResult {
  /** Xã / Phường (ward) — the telecom station naming unit. */
  ward: string | null;
  /** Quận / Huyện (district). */
  district: string | null;
  /** Tỉnh / Thành phố (province). */
  province: string | null;
  /** Full Nominatim display string, for logging/debugging. */
  displayName: string | null;
  /** Admin boundary polygon of the matched object (SRID 4326), if any. */
  polygon: GeoMultiPolygon | null;
}

/** Shape of the bits of the Nominatim `/reverse` response we read. */
interface NominatimReverse {
  display_name?: string;
  address?: Record<string, string>;
  geojson?: GeoPolygon | GeoMultiPolygon | { type: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reverse-geocoding over OpenStreetMap Nominatim — turns a coordinate into its
 * Vietnamese ward / district / province names plus the matched admin polygon.
 *
 * Used to (a) name telecom stations by their ward ("Trạm Đông Hà") and (b) build
 * a real province boundary when a station falls outside the seeded provinces (see
 * {@link ProvinceResolverService}).
 *
 * Two guards keep us within Nominatim's usage policy and fast on repeats:
 *   - **Rate limit**: calls are serialized with a minimum interval (default 1.1s,
 *     the public server's ≤1 req/s rule). Point `NOMINATIM_URL` at a self-hosted
 *     instance to lift this for the 10k backfill.
 *   - **Cache**: every result (including sea = `null`) is cached in Redis keyed by
 *     coordinate, so re-runs and duplicate points cost nothing.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly email?: string;
  private readonly zoom: number;
  private readonly rateLimitMs: number;
  private readonly timeoutMs: number;
  private readonly cacheTtlS: number;

  /** Serializes network calls so we never exceed the configured rate. */
  private gate: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.baseUrl = (
      this.config.get<string>('NOMINATIM_URL') ??
      'https://nominatim.openstreetmap.org'
    ).replace(/\/+$/, '');
    this.email = this.config.get<string>('NOMINATIM_EMAIL') || undefined;
    this.userAgent =
      this.config.get<string>('NOMINATIM_USER_AGENT') ??
      `flood-warning-system/1.0${this.email ? ` (${this.email})` : ''}`;
    this.zoom = parseInt(this.config.get<string>('GEOCODE_ZOOM') ?? '14', 10);
    this.rateLimitMs = parseInt(
      this.config.get<string>('GEOCODE_RATE_LIMIT_MS') ?? '1100',
      10,
    );
    this.timeoutMs = parseInt(
      this.config.get<string>('GEOCODE_TIMEOUT_MS') ?? '15000',
      10,
    );
    this.cacheTtlS = parseInt(
      this.config.get<string>('GEOCODE_CACHE_TTL_S') ?? '2592000', // 30 days
      10,
    );
  }

  /**
   * Reverse-geocode a coordinate. Returns the admin names + polygon, or `null`
   * when Nominatim has no match (sea / outside coverage). Cache hits skip the
   * rate limiter entirely.
   */
  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const key = `geocode:rev:${lat.toFixed(4)}:${lng.toFixed(4)}`;
    const cached = await this.redis.client.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as GeocodeResult | null;
    }

    let result: GeocodeResult | null = null;
    try {
      result = await this.throttle(() => this.fetchReverse(lat, lng));
    } catch (err) {
      // Don't cache transient failures — let the next pass retry.
      this.logger.warn(
        `reverse(${lat},${lng}) failed: ${(err as Error).message}`,
      );
      return null;
    }
    await this.redis.client.set(key, JSON.stringify(result), 'EX', this.cacheTtlS);
    return result;
  }

  /** Run `fn` no sooner than `rateLimitMs` after the previous network call. */
  private throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(async () => {
      const wait = this.rateLimitMs - (Date.now() - this.lastCallAt);
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      return fn();
    });
    // Keep the chain alive even if this call rejects.
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async fetchReverse(
    lat: number,
    lng: number,
  ): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: String(this.zoom),
      addressdetails: '1',
      polygon_geojson: '1',
      'accept-language': 'vi',
    });
    if (this.email) params.set('email', this.email);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/reverse?${params.toString()}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

    const data = (await res.json()) as NominatimReverse | { error?: unknown };
    if (!data || 'error' in data || !('address' in data)) return null;

    const body = data as NominatimReverse;
    const addr = body.address ?? {};
    return {
      ward: this.pick(addr, [
        'quarter',
        'suburb',
        'ward',
        'village',
        'hamlet',
        'neighbourhood',
        'town',
        'city_district',
      ]),
      district: this.pick(addr, ['city_district', 'county', 'district', 'town']),
      province: this.pick(addr, [
        'state',
        'province',
        'city',
        'region',
        'municipality',
      ]),
      displayName: body.display_name ?? null,
      polygon: this.toMultiPolygon(body.geojson),
    };
  }

  /** First non-empty value among the candidate address fields. */
  private pick(addr: Record<string, string>, keys: string[]): string | null {
    for (const k of keys) {
      const v = addr[k]?.trim();
      if (v) return v;
    }
    return null;
  }

  /** Normalize a (Multi)Polygon GeoJSON to MultiPolygon; drop anything else. */
  private toMultiPolygon(
    geo: NominatimReverse['geojson'] | undefined,
  ): GeoMultiPolygon | null {
    if (!geo) return null;
    if (geo.type === 'MultiPolygon') return geo as GeoMultiPolygon;
    if (geo.type === 'Polygon') {
      return { type: 'MultiPolygon', coordinates: [(geo as GeoPolygon).coordinates] };
    }
    return null; // Point / LineString → not a usable province boundary
  }
}
