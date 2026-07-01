import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Group E map-enrichment index. APIs 27/30 seek the nearest forecast row of the
 * latest snapshot per in-view station; the existing (station_id, forecast_time)
 * index can't seek by snapshot, forcing a whole-snapshot scan. This composite
 * (station_id, snapshot_id, forecast_time) turns the viewport read into index seeks.
 */
export class MapForecastIndex1738000000000 implements MigrationInterface {
  name = 'MapForecastIndex1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_weather_forecasts_station_snapshot_time"
         ON "weather_forecasts" ("station_id", "snapshot_id", "forecast_time")`,
    );
    // Refresh planner stats so the index is used immediately on a populated table.
    await queryRunner.query(`ANALYZE "weather_forecasts"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_weather_forecasts_station_snapshot_time"`,
    );
  }
}
