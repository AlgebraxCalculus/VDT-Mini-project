-- Re-sync every SERIAL/BIGSERIAL sequence to MAX(id)+1.
--
-- Why: the seed CSVs in /data insert rows with EXPLICIT id values (1..N) but do
-- not advance the owning sequences. So the next app INSERT (e.g. creating a
-- station or its flood_thresholds) reuses id=1 and fails with
-- "duplicate key value violates unique constraint ..._pkey".
--
-- Run this ONCE after loading the seed data (and again after any future
-- explicit-id import). It is idempotent and safe to re-run.
--
-- From the host:
--   docker compose exec -T db psql -U flood -d flood_warning < backend/docker/reset-sequences.sql
--
-- It loops over all sequences owned by a column (covers SERIAL & BIGSERIAL) and
-- sets each to COALESCE(MAX(col),0)+1, so the next generated id is collision-free.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
    FROM pg_class s
    JOIN pg_depend d   ON d.objid = s.oid AND d.deptype = 'a'
    JOIN pg_class t    ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE s.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)',
      r.seq, r.col, r.tbl
    );
    RAISE NOTICE 'reset sequence % -> max(%.%)+1', r.seq, r.tbl, r.col;
  END LOOP;
END $$;
