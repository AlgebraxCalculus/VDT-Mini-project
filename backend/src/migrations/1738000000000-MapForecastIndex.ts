import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Group E (map / GIS) performance index.
 *
 * `GET /map/stations` (API 27) and `GET /map/stations/search` (API 30) enrich each
 * in-view station with the nearest forecast row of the **latest snapshot**
 * (DISTINCT ON (station_id) … WHERE snapshot_id = $latest ORDER BY forecast_time).
 * The existing `idx_weather_forecasts_station_time (station_id, forecast_time)`
 * can't seek by snapshot, so the planner scanned the whole latest snapshot
 * (~800k rows on a full dataset) and join-filtered by station — multi-second.
 *
 * This composite index `(station_id, snapshot_id, forecast_time)` lets the
 * enrichment nested-loop seek directly to each in-view station's rows for the
 * target snapshot, in forecast_time order — turning the viewport read into a
 * handful of index seeks (sub-100 ms for a real zoomed-in viewport). Leading
 * `station_id` keeps it a strict superset-shaped complement to the existing
 * station_time index without duplicating its use.
 */
export class MapForecastIndex1738000000000 implements MigrationInterface {
  name = 'MapForecastIndex1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_weather_forecasts_station_snapshot_time"
         ON "weather_forecasts" ("station_id", "snapshot_id", "forecast_time")`,
    );
    // Refresh planner stats so the new index is used immediately even when added
    // on top of an already-populated table (without this the planner may keep the
    // old whole-snapshot scan until the next autovacuum analyze).
    await queryRunner.query(`ANALYZE "weather_forecasts"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_weather_forecasts_station_snapshot_time"`,
    );
  }
}
