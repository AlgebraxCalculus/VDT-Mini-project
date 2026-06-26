/**
 * Viewport ↔ room mapping (tile-based), per the design's "subscribe viewport room
 * (tile-based)". Clients subscribe to the slippy-map tiles their bounding box
 * covers at a fixed index zoom; a station's risk delta maps to exactly one tile,
 * so the gateway can route it to the right room(s) without a spatial query.
 */

/**
 * Fixed indexing zoom for room granularity. Independent of the client's actual
 * map zoom. z=7 ≈ ~310 km tiles at the equator — coarse enough that a typical
 * viewport spans only a handful of rooms, fine enough to keep per-room fan-out
 * small for Vietnam's extent.
 */
export const VIEWPORT_INDEX_ZOOM = 7;

/**
 * Safety cap on rooms joined per subscribe. A viewport this wide is zoomed out
 * past the point where per-station deltas are useful; we clamp instead of letting
 * a client join thousands of rooms.
 */
export const MAX_ROOMS_PER_SUBSCRIBE = 256;

/** Room prefix so the gateway can find/leave all viewport rooms on a socket. */
export const VIEWPORT_ROOM_PREFIX = 'vp:';

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const clampLat = (lat: number): number => Math.max(-85.05112878, Math.min(85.05112878, lat));

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

export function roomKey(x: number, y: number, z = VIEWPORT_INDEX_ZOOM): string {
  return `${VIEWPORT_ROOM_PREFIX}${z}:${x}:${y}`;
}

/** The single room a station (by coordinates) belongs to. */
export function stationRoom(
  lng: number,
  lat: number,
  z = VIEWPORT_INDEX_ZOOM,
): string {
  return roomKey(lngToTileX(lng, z), latToTileY(lat, z), z);
}

/**
 * All rooms a bounding box covers at the index zoom. Result is clamped to
 * {@link MAX_ROOMS_PER_SUBSCRIBE}; `clamped` flags when the viewport was too wide
 * and the tile set was truncated.
 */
export function bboxToRooms(
  bbox: Bbox,
  z = VIEWPORT_INDEX_ZOOM,
): { rooms: string[]; clamped: boolean } {
  const max = 2 ** z;
  const xMin = Math.max(0, lngToTileX(bbox.minLng, z));
  const xMax = Math.min(max - 1, lngToTileX(bbox.maxLng, z));
  // Tile Y grows southward, so maxLat yields the smaller Y.
  const yMin = Math.max(0, latToTileY(bbox.maxLat, z));
  const yMax = Math.min(max - 1, latToTileY(bbox.minLat, z));

  const rooms: string[] = [];
  let clamped = false;
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      if (rooms.length >= MAX_ROOMS_PER_SUBSCRIBE) {
        clamped = true;
        return { rooms, clamped };
      }
      rooms.push(roomKey(x, y, z));
    }
  }
  return { rooms, clamped };
}

/**
 * Validate + normalize a raw subscribe payload into a Bbox. Accepts either
 * `{ bbox: [minLng, minLat, maxLng, maxLat] }` or
 * `{ bbox: { minLng, minLat, maxLng, maxLat } }`. Returns null if invalid.
 */
export function parseBbox(input: unknown): Bbox | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { bbox?: unknown }).bbox ?? input;

  let coords: Partial<Bbox>;
  if (Array.isArray(raw)) {
    if (raw.length !== 4) return null;
    const [minLng, minLat, maxLng, maxLat] = raw;
    coords = { minLng, minLat, maxLng, maxLat };
  } else if (raw && typeof raw === 'object') {
    coords = raw as Partial<Bbox>;
  } else {
    return null;
  }

  const { minLng, minLat, maxLng, maxLat } = coords;
  const nums = [minLng, minLat, maxLng, maxLat];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return null;
  }
  if (
    (minLng as number) < -180 ||
    (maxLng as number) > 180 ||
    (minLat as number) < -90 ||
    (maxLat as number) > 90 ||
    (minLng as number) > (maxLng as number) ||
    (minLat as number) > (maxLat as number)
  ) {
    return null;
  }

  return {
    minLng: minLng as number,
    minLat: minLat as number,
    maxLng: maxLng as number,
    maxLat: maxLat as number,
  };
}
