import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The `/map/stations` `fc` CTE and `/map/weather` overlay both bind snapshot_id +
 * station_id as equality and order by forecast_time; this composite lets Postgres
 * seek the ordered rows instead of scanning a station's whole forecast history
 * (the existing (station_id, forecast_time) index leaves snapshot_id residual).
 */
export class AddMapPerfIndexes1783334400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_weather_forecasts_snapshot_station_time"
         ON "weather_forecasts" ("snapshot_id", "station_id", "forecast_time")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_weather_forecasts_snapshot_station_time"`,
    );
  }
}
