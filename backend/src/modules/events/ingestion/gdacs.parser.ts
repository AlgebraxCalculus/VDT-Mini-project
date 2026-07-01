/**
 * GDACS events4app (a GeoJSON FeatureCollection of active global hazards) →
 * normalized disaster events. Keeps only TC→STORM and FL→FLOOD. Defensive parsing:
 * the payload may arrive via a read-proxy and field casing varies across hazards.
 */

/** How the affected area is expressed for downstream spatial queries. */
export type AffectedGeom =
  | { kind: 'point'; lon: number; lat: number; radiusDeg: number }
  | { kind: 'bbox'; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: 'geojson'; geojson: string };

export interface NormalizedDisaster {
  /** GDACS event id, e.g. "1000810". */
  externalId: string;
  typeCode: 'STORM' | 'FLOOD';
  /** disaster_type label (seeded if missing). */
  typeName: string;
  /** Dedupe key + event_code column, e.g. "GDACS-TC1000810". */
  eventCode: string;
  /** Display name (≤255). */
  name: string;
  /** GDACS alert level (Green/Orange/Red) if present. */
  alertLevel: string | null;
  startTime: Date;
  /** Geometry for VN filtering + scope assignment. */
  geom: AffectedGeom;
}

/** Per-hazard buffer radii (degrees) for point-only hazards. */
export interface RadiusConfig {
  storm: number;
  flood: number;
  /** Per-alert-level multipliers on the base radius. */
  alertMultiplier: { red: number; orange: number; green: number };
}

export const DEFAULT_RADIUS_CONFIG: RadiusConfig = {
  storm: 2.5,
  flood: 0.8,
  alertMultiplier: { red: 1.5, orange: 1.0, green: 0.6 },
};

/** GDACS hazard code → our domain type. Unmapped hazards (EQ/VO/WF/DR/TS) are dropped. */
const TYPE_MAP: Record<string, { code: 'STORM' | 'FLOOD'; name: string }> = {
  TC: { code: 'STORM', name: 'Bão' },
  FL: { code: 'FLOOD', name: 'Lũ lụt' },
};

/** Max bbox span (deg) before falling back to a point buffer — guards against a global-track bbox scoping the whole map. */
const MAX_BBOX_SPAN_DEG = 25;

interface RawFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  bbox?: unknown;
  properties?: Record<string, unknown> | null;
}

/** Parse the raw events4app payload into normalized STORM/FLOOD events. */
export function parseGdacsEvents(
  raw: unknown,
  radii: RadiusConfig = DEFAULT_RADIUS_CONFIG,
): NormalizedDisaster[] {
  const features = extractFeatures(raw);
  const out: NormalizedDisaster[] = [];

  for (const f of features) {
    const props = f.properties ?? {};
    const eventType = String(str(props, 'eventtype') ?? '').toUpperCase();
    const mapped = TYPE_MAP[eventType];
    if (!mapped) continue;

    const externalId = str(props, 'eventid', 'eventId', 'id');
    if (!externalId) continue;

    const geom = pickGeometry(f, mapped.code, str(props, 'alertlevel'), radii);
    if (!geom) continue; // no usable location → can't scope

    const alertLevel = str(props, 'alertlevel', 'episodealertlevel') ?? null;
    const rawName =
      str(props, 'name', 'eventname', 'htmldescription') ??
      `${mapped.name} ${externalId}`;

    out.push({
      externalId,
      typeCode: mapped.code,
      typeName: mapped.name,
      eventCode: `GDACS-${eventType}${externalId}`,
      name: rawName.slice(0, 255),
      alertLevel,
      startTime: parseDate(str(props, 'fromdate', 'datemodified')),
      geom,
    });
  }

  return out;
}

// --- Internals ---

function extractFeatures(raw: unknown): RawFeature[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { features?: unknown };
  return Array.isArray(obj.features) ? (obj.features as RawFeature[]) : [];
}

/** Pick the most informative usable geometry: polygon → sane bbox → point buffer. */
function pickGeometry(
  f: RawFeature,
  typeCode: 'STORM' | 'FLOOD',
  alertLevel: string | undefined,
  radii: RadiusConfig,
): AffectedGeom | null {
  const g = f.geometry;
  const gType = g?.type?.toLowerCase();

  // Explicit polygon footprint — best fidelity.
  if ((gType === 'polygon' || gType === 'multipolygon') && g) {
    try {
      return { kind: 'geojson', geojson: JSON.stringify(g) };
    } catch {
      /* fall through */
    }
  }

  const bbox = asBbox(f.bbox);
  if (bbox) return bbox;

  const pt = asPoint(g?.coordinates);
  if (pt) return pointToGeom(pt.lon, pt.lat, typeCode, alertLevel, radii);

  return null;
}

/** A point buffered by hazard type and alert level. Shared with the EONET parser. */
export function pointToGeom(
  lon: number,
  lat: number,
  typeCode: 'STORM' | 'FLOOD',
  alertLevel: string | undefined,
  radii: RadiusConfig,
): AffectedGeom {
  const base = typeCode === 'STORM' ? radii.storm : radii.flood;
  return { kind: 'point', lon, lat, radiusDeg: base * alertMult(alertLevel, radii) };
}

function asBbox(value: unknown): AffectedGeom | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [minX, minY, maxX, maxY] = value.map(Number);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  if (w > MAX_BBOX_SPAN_DEG || h > MAX_BBOX_SPAN_DEG) return null;
  return { kind: 'bbox', minX, minY, maxX, maxY };
}

function asPoint(coords: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function alertMult(alertLevel: string | undefined, radii: RadiusConfig): number {
  switch ((alertLevel ?? '').toLowerCase()) {
    case 'red':
      return radii.alertMultiplier.red;
    case 'orange':
      return radii.alertMultiplier.orange;
    case 'green':
      return radii.alertMultiplier.green;
    default:
      return radii.alertMultiplier.orange;
  }
}

/** Read the first present key as a trimmed non-empty string, else undefined. */
function str(
  props: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return undefined;
}

/** Parse a date string, defaulting to now on missing/invalid input. */
export function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
