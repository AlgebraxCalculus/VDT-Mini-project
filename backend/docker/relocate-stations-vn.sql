-- Relocate every station to a random point INSIDE the seeded province polygons.
--
-- Why: the station seed (data/stations.csv) generated lat/lng uniformly across
-- Vietnam's *bounding rectangle* (lat 8.5..23.3, lng 102.1..109.4), so ~60% of
-- points fell into Laos, Thailand, Cambodia, China or the sea. This rewrites
-- geom/lat/lng so each station sits within the union of the province boundaries
-- (real VN centroids), and re-derives province_id by point-in-polygon — the same
-- ST_Contains rule StationsService.applyGeometry uses on create/update.
--
-- Idempotent: re-run any time (e.g. after re-importing the station CSV onto a
-- fresh DB volume). Pure server-side SQL — no per-row data shipped from the app.
--
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -f /path/to/relocate-stations-vn.sql
--
-- NOTE: the seeded province boundaries are axis-aligned rectangles around real
-- province centroids, not true administrative shapes — so stations cluster into
-- those rectangles rather than filling Vietnam's outline. Load real province
-- GeoJSON into provinces.boundary and re-run this to get a true country fill.

WITH vn AS (
  SELECT ST_Union(boundary) AS g FROM provinces WHERE boundary IS NOT NULL
),
-- Request ~5% extra points: ST_GeneratePoints returns slightly more/fewer than
-- asked for a MultiPolygon. The 1:1 row_number join below then pairs the first N
-- points with the N stations; any surplus points are simply dropped.
pts AS (
  SELECT (ST_Dump(
            ST_GeneratePoints((SELECT g FROM vn), (SELECT ceil(count(*) * 1.05)::int FROM stations))
         )).geom AS pt
),
np AS (SELECT pt, row_number() OVER () AS rn FROM pts),
ns AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM stations)
UPDATE stations s
SET geom        = ST_SetSRID(np.pt, 4326),
    latitude    = round(ST_Y(np.pt)::numeric, 6),
    longitude   = round(ST_X(np.pt)::numeric, 6),
    province_id = (
      SELECT p.id FROM provinces p
      WHERE p.boundary IS NOT NULL AND ST_Contains(p.boundary, np.pt)
      ORDER BY ST_Distance(p.centroid, np.pt)  -- break ties on overlapping rectangles
      LIMIT 1
    ),
    updated_at  = now()
FROM np JOIN ns ON ns.rn = np.rn
WHERE s.id = ns.id;
