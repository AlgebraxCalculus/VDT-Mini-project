/**
 * NASA EONET v3 events → normalized disaster events.
 *
 * EONET is the geometry-bearing fallback for event ingestion (used when GDACS is
 * unreachable). Its payload is `{ events: [{ id, title, categories:[{id,title}],
 * geometry:[{date,type,coordinates}] }] }`. We keep only the two hazards this
 * system models — severe storms (→ STORM) and floods (→ FLOOD) — and reduce each
 * to the same {@link NormalizedDisaster} shape the ingestion service consumes, so
 * downstream scoping is source-agnostic.
 *
 * Parsing is defensive: geometry is a *track* (one entry per observation), so we
 * take the most recent usable entry; a Point becomes a type/size buffer via the
 * shared {@link pointToGeom}, a Polygon is passed through as GeoJSON.
 */

import {
  AffectedGeom,
  DEFAULT_RADIUS_CONFIG,
  NormalizedDisaster,
  parseDate,
  pointToGeom,
  RadiusConfig,
} from './gdacs.parser';

/** EONET category id/title → our domain type. Other categories are dropped. */
function mapCategory(
  categories: unknown,
): { code: 'STORM' | 'FLOOD'; name: string } | null {
  if (!Array.isArray(categories)) return null;
  for (const c of categories) {
    const id = String((c as { id?: unknown })?.id ?? '').toLowerCase();
    const title = String((c as { title?: unknown })?.title ?? '').toLowerCase();
    const hay = `${id} ${title}`;
    if (hay.includes('severestorm') || hay.includes('severe storm'))
      return { code: 'STORM', name: 'Bão' };
    if (hay.includes('flood')) return { code: 'FLOOD', name: 'Lũ lụt' };
  }
  return null;
}

interface RawGeometry {
  date?: string;
  type?: string;
  coordinates?: unknown;
}

/** Parse the EONET events payload into normalized STORM/FLOOD events. */
export function parseEonetEvents(
  raw: unknown,
  radii: RadiusConfig = DEFAULT_RADIUS_CONFIG,
): NormalizedDisaster[] {
  const events = extractEvents(raw);
  const out: NormalizedDisaster[] = [];

  for (const ev of events) {
    const mapped = mapCategory(ev.categories);
    if (!mapped) continue; // not a hazard we model

    const externalId = str(ev.id);
    if (!externalId) continue;

    const track = Array.isArray(ev.geometry) ? (ev.geometry as RawGeometry[]) : [];
    const latest = latestGeometry(track);
    const geom = latest ? pickGeometry(latest, mapped.code, radii) : null;
    if (!geom) continue; // no usable location → can't scope it

    out.push({
      externalId,
      typeCode: mapped.code,
      typeName: mapped.name,
      eventCode: `EONET-${externalId}`,
      name: (str(ev.title) ?? `${mapped.name} ${externalId}`).slice(0, 255),
      alertLevel: null, // EONET has no alert-level concept
      startTime: parseDate(latest?.date ?? track[0]?.date),
      geom,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RawEvent {
  id?: unknown;
  title?: unknown;
  categories?: unknown;
  geometry?: unknown;
}

function extractEvents(raw: unknown): RawEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { events?: unknown };
  return Array.isArray(obj.events) ? (obj.events as RawEvent[]) : [];
}

/** The newest geometry entry by date (falls back to the last array element). */
function latestGeometry(track: RawGeometry[]): RawGeometry | null {
  if (track.length === 0) return null;
  let best: RawGeometry | null = null;
  let bestTs = -Infinity;
  for (const g of track) {
    const ts = g.date ? new Date(g.date).getTime() : NaN;
    if (Number.isFinite(ts) && ts >= bestTs) {
      bestTs = ts;
      best = g;
    }
  }
  return best ?? track[track.length - 1];
}

/** A polygon → GeoJSON footprint; a point → a type/alert-sized buffer. */
function pickGeometry(
  g: RawGeometry,
  typeCode: 'STORM' | 'FLOOD',
  radii: RadiusConfig,
): AffectedGeom | null {
  const type = String(g.type ?? '').toLowerCase();

  if ((type === 'polygon' || type === 'multipolygon') && g.coordinates != null) {
    try {
      return {
        kind: 'geojson',
        geojson: JSON.stringify({ type: g.type, coordinates: g.coordinates }),
      };
    } catch {
      /* fall through to point handling */
    }
  }

  const pt = asPoint(g.coordinates);
  if (pt) return pointToGeom(pt.lon, pt.lat, typeCode, undefined, radii);

  return null;
}

function asPoint(coords: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

/** Trim to a non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}
