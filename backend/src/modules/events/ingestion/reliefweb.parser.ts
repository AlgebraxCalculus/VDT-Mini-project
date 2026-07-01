/**
 * ReliefWeb (UN OCHA) disasters → normalized disaster events. Last-resort event
 * fallback (GDACS and EONET both down). Records are country-level with no geometry,
 * so scope is a Vietnam-wide bbox — coarse, but a tracked event beats none; the next
 * GDACS/EONET run supersedes it with a precise footprint.
 */

import { AffectedGeom, NormalizedDisaster, parseDate } from './gdacs.parser';

/** Vietnam's approximate bbox (WGS84); intersects every province. */
export const VIETNAM_BBOX: AffectedGeom = {
  kind: 'bbox',
  minX: 102.0,
  minY: 8.0,
  maxX: 110.0,
  maxY: 23.5,
};

/** ReliefWeb primary_type.name → our domain type. Other types are dropped. */
function mapType(typeName: string): { code: 'STORM' | 'FLOOD'; name: string } | null {
  const t = typeName.toLowerCase();
  if (t.includes('flood')) return { code: 'FLOOD', name: 'Lũ lụt' };
  if (t.includes('cyclone') || t.includes('storm') || t.includes('typhoon'))
    return { code: 'STORM', name: 'Bão' };
  return null;
}

/** ReliefWeb statuses we treat as active; 'past' (and anything else) is skipped. */
const ACTIVE_STATUSES = new Set(['alert', 'ongoing', 'current']);

/** Parse the ReliefWeb disasters payload into normalized STORM/FLOOD events. */
export function parseReliefWebEvents(raw: unknown): NormalizedDisaster[] {
  const rows = extractData(raw);
  const out: NormalizedDisaster[] = [];

  for (const row of rows) {
    const id = str(row.id);
    if (!id) continue;
    const fields = (row.fields ?? {}) as Record<string, unknown>;

    const typeName = str(pluck(fields.primary_type, 'name'));
    const mapped = typeName ? mapType(typeName) : null;
    if (!mapped) continue;

    const status = (str(fields.status) ?? '').toLowerCase();
    if (status && !ACTIVE_STATUSES.has(status)) continue;

    out.push({
      externalId: id,
      typeCode: mapped.code,
      typeName: mapped.name,
      eventCode: `RW-${id}`,
      name: (str(fields.name) ?? `${mapped.name} ${id}`).slice(0, 255),
      alertLevel: status || null,
      startTime: parseDate(str(pluck(fields.date, 'created'))),
      geom: VIETNAM_BBOX,
    });
  }

  return out;
}

// --- Internals ---

interface RawRow {
  id?: unknown;
  fields?: unknown;
}

function extractData(raw: unknown): RawRow[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { data?: unknown };
  return Array.isArray(obj.data) ? (obj.data as RawRow[]) : [];
}

/** Read a nested property off a possibly-missing object. */
function pluck(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
  return undefined;
}

/** Trim to a non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}
