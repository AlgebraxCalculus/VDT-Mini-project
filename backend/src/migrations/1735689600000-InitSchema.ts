import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initialize the disaster-warning schema (PostgreSQL + PostGIS).
 * Telecom flood-risk warning system: users/roles, GIS provinces & stations,
 * flood thresholds, disaster events, weather snapshots/forecasts, risk & alerts.
 */
export class InitSchema1735689600000 implements MigrationInterface {
  name = 'InitSchema1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Spatial extension (provinces.boundary, stations.geom, event_provinces.affected_area ...)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    // 2. roles (created before users: users.role_id -> roles.id)
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          SERIAL PRIMARY KEY,
        "code"        VARCHAR(20) UNIQUE NOT NULL,
        "name"        VARCHAR(100)       NOT NULL,
        "description" TEXT,
        "permissions" JSONB              NOT NULL DEFAULT '[]'::jsonb,
        "created_at"  TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ        NOT NULL DEFAULT now()
      )
    `);

    // 1. users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            SERIAL PRIMARY KEY,
        "username"      VARCHAR(100) UNIQUE NOT NULL,
        "email"         VARCHAR(255) UNIQUE NOT NULL,
        "password_hash" VARCHAR(255)        NOT NULL,
        "full_name"     VARCHAR(255),
        "is_active"     BOOLEAN             NOT NULL DEFAULT TRUE,
        "last_login_at" TIMESTAMPTZ,
        "created_at"    TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "role_id"       INT,
        CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_users_role_id" ON "users" ("role_id")`);
    await queryRunner.query(`CREATE INDEX "idx_users_is_active" ON "users" ("is_active")`);

    // 3. provinces (admin boundary polygon + centroid, for point-in-polygon)
    await queryRunner.query(`
      CREATE TABLE "provinces" (
        "id"       SERIAL PRIMARY KEY,
        "code"     VARCHAR(20) UNIQUE NOT NULL,
        "name"     VARCHAR(255)       NOT NULL,
        "boundary" GEOMETRY(MultiPolygon, 4326),
        "centroid" GEOMETRY(Point, 4326)
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_provinces_boundary" ON "provinces" USING GIST ("boundary")`);
    await queryRunner.query(`CREATE INDEX "idx_provinces_centroid" ON "provinces" USING GIST ("centroid")`);

    // 4. stations
    await queryRunner.query(`
      CREATE TABLE "stations" (
        "id"           SERIAL PRIMARY KEY,
        "station_code" VARCHAR(50) UNIQUE NOT NULL,
        "name"         VARCHAR(255)       NOT NULL,
        "latitude"     DECIMAL(9, 6),
        "longitude"    DECIMAL(9, 6),
        "geom"         GEOMETRY(Point, 4326),
        "elevation"    DECIMAL(7, 2),
        "province_id"  INT,
        "risk_status"  VARCHAR(20),
        "is_deleted"   BOOLEAN            NOT NULL DEFAULT FALSE,
        "deleted_at"   TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ        NOT NULL DEFAULT now(),
        CONSTRAINT "stations_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_stations_geom" ON "stations" USING GIST ("geom")`);
    await queryRunner.query(`CREATE INDEX "idx_stations_province_id" ON "stations" ("province_id")`);
    await queryRunner.query(`CREATE INDEX "idx_stations_risk_status" ON "stations" ("risk_status")`);
    await queryRunner.query(`CREATE INDEX "idx_stations_is_deleted" ON "stations" ("is_deleted")`);

    // 5. flood_thresholds (multi-level alert thresholds per station)
    await queryRunner.query(`
      CREATE TABLE "flood_thresholds" (
        "id"              SERIAL PRIMARY KEY,
        "station_id"      INT           NOT NULL,
        "alert_level"     INT           NOT NULL,
        "threshold_value" DECIMAL(7, 2) NOT NULL,
        "label"           VARCHAR(100),
        "effective_from"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "flood_thresholds_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_flood_thresholds_station_id" ON "flood_thresholds" ("station_id")`);
    await queryRunner.query(`CREATE INDEX "idx_flood_thresholds_station_level" ON "flood_thresholds" ("station_id", "alert_level")`);

    // 6. disaster_types
    await queryRunner.query(`
      CREATE TABLE "disaster_types" (
        "id"   SERIAL PRIMARY KEY,
        "code" VARCHAR(30) UNIQUE NOT NULL,
        "name" VARCHAR(100)       NOT NULL
      )
    `);

    // 7. disaster_events
    await queryRunner.query(`
      CREATE TABLE "disaster_events" (
        "id"               BIGSERIAL PRIMARY KEY,
        "event_code"       VARCHAR(50) UNIQUE NOT NULL,
        "disaster_type_id" INT                NOT NULL,
        "name"             VARCHAR(255)       NOT NULL,
        "status"           VARCHAR(20)        NOT NULL,
        "start_time"       TIMESTAMPTZ        NOT NULL,
        "end_time"         TIMESTAMPTZ,
        "description"      TEXT,
        "created_by"       INT,
        "created_at"       TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ        NOT NULL DEFAULT now(),
        CONSTRAINT "disaster_events_disaster_type_id_fkey" FOREIGN KEY ("disaster_type_id") REFERENCES "disaster_types" ("id"),
        CONSTRAINT "disaster_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_disaster_events_disaster_type_id" ON "disaster_events" ("disaster_type_id")`);
    await queryRunner.query(`CREATE INDEX "idx_disaster_events_status" ON "disaster_events" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_disaster_events_created_by" ON "disaster_events" ("created_by")`);

    // 8. event_provinces (N-N event <-> province, with affected-area polygon)
    await queryRunner.query(`
      CREATE TABLE "event_provinces" (
        "id"            BIGSERIAL PRIMARY KEY,
        "event_id"      BIGINT      NOT NULL,
        "province_id"   INT         NOT NULL,
        "affected_area" GEOMETRY(Polygon, 4326),
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "event_provinces_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events" ("id") ON DELETE CASCADE,
        CONSTRAINT "event_provinces_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces" ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_event_provinces_event_province" ON "event_provinces" ("event_id", "province_id")`);
    await queryRunner.query(`CREATE INDEX "idx_event_provinces_affected_area" ON "event_provinces" USING GIST ("affected_area")`);

    // 9. event_stations (N-N event <-> station, composite PK)
    await queryRunner.query(`
      CREATE TABLE "event_stations" (
        "event_id"   BIGINT      NOT NULL,
        "station_id" INT         NOT NULL,
        "added_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "event_stations_pkey" PRIMARY KEY ("event_id", "station_id"),
        CONSTRAINT "event_stations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events" ("id") ON DELETE CASCADE,
        CONSTRAINT "event_stations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_event_stations_station_id" ON "event_stations" ("station_id")`);

    // 10. weather_snapshots (metadata of each external forecast refresh)
    await queryRunner.query(`
      CREATE TABLE "weather_snapshots" (
        "id"           BIGSERIAL PRIMARY KEY,
        "source_code"  VARCHAR(50) NOT NULL,
        "fetched_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "trigger_type" VARCHAR(20) NOT NULL,
        "triggered_by" INT,
        "raw_payload"  JSONB,
        "status"       VARCHAR(20),
        CONSTRAINT "weather_snapshots_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_weather_snapshots_source_code" ON "weather_snapshots" ("source_code")`);
    await queryRunner.query(`CREATE INDEX "idx_weather_snapshots_fetched_at" ON "weather_snapshots" ("fetched_at")`);

    // 11. weather_forecasts (time-series forecast 5-7 days per station or province)
    await queryRunner.query(`
      CREATE TABLE "weather_forecasts" (
        "id"                BIGSERIAL PRIMARY KEY,
        "snapshot_id"       BIGINT      NOT NULL,
        "station_id"        INT,
        "province_id"       INT,
        "forecast_time"     TIMESTAMPTZ NOT NULL,
        "temperature"       DECIMAL(5, 2),
        "rainfall"          DECIMAL(7, 2),
        "wind_speed"        DECIMAL(6, 2),
        "wind_direction"    DECIMAL(6, 2),
        "river_water_level" DECIMAL(7, 2),
        CONSTRAINT "weather_forecasts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "weather_snapshots" ("id") ON DELETE CASCADE,
        CONSTRAINT "weather_forecasts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations" ("id"),
        CONSTRAINT "weather_forecasts_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_weather_forecasts_snapshot_id" ON "weather_forecasts" ("snapshot_id")`);
    await queryRunner.query(`CREATE INDEX "idx_weather_forecasts_station_time" ON "weather_forecasts" ("station_id", "forecast_time")`);
    await queryRunner.query(`CREATE INDEX "idx_weather_forecasts_province_time" ON "weather_forecasts" ("province_id", "forecast_time")`);

    // 12. station_risk_assessments (precomputed by cronjob, 5-7 day risk timeline)
    await queryRunner.query(`
      CREATE TABLE "station_risk_assessments" (
        "id"                    BIGSERIAL PRIMARY KEY,
        "station_id"            INT         NOT NULL,
        "event_id"              BIGINT,
        "forecast_date"         DATE        NOT NULL,
        "predicted_water_level" DECIMAL(7, 2),
        "threshold_value"       DECIMAL(7, 2),
        "is_exceeded"           BOOLEAN     NOT NULL DEFAULT FALSE,
        "severity"              VARCHAR(20),
        "risk_score"            DECIMAL(5, 2),
        "computed_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "station_risk_assessments_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations" ("id") ON DELETE CASCADE,
        CONSTRAINT "station_risk_assessments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_station_risk_assessments_station_date" ON "station_risk_assessments" ("station_id", "forecast_date")`);
    await queryRunner.query(`CREATE INDEX "idx_station_risk_assessments_event_id" ON "station_risk_assessments" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "idx_station_risk_assessments_severity" ON "station_risk_assessments" ("severity")`);

    // 13. alert_histories (snapshot of triggered alerts: actual vs threshold)
    await queryRunner.query(`
      CREATE TABLE "alert_histories" (
        "id"                  BIGSERIAL PRIMARY KEY,
        "station_id"          INT         NOT NULL,
        "event_id"            BIGINT,
        "alert_level"         INT         NOT NULL,
        "triggered_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "actual_value"        DECIMAL(7, 2),
        "threshold_value"     DECIMAL(7, 2),
        "reason"              TEXT,
        "weather_snapshot_id" BIGINT,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "alert_histories_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations" ("id") ON DELETE CASCADE,
        CONSTRAINT "alert_histories_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events" ("id"),
        CONSTRAINT "alert_histories_weather_snapshot_id_fkey" FOREIGN KEY ("weather_snapshot_id") REFERENCES "weather_snapshots" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_alert_histories_station_id" ON "alert_histories" ("station_id")`);
    await queryRunner.query(`CREATE INDEX "idx_alert_histories_event_id" ON "alert_histories" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "idx_alert_histories_triggered_at" ON "alert_histories" ("triggered_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order.
    await queryRunner.query(`DROP TABLE IF EXISTS "alert_histories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "station_risk_assessments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_forecasts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_stations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_provinces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disaster_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disaster_types"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "flood_thresholds"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provinces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
