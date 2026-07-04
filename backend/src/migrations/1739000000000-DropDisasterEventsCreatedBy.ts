import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop `disaster_events.created_by`. Events are no longer created by a user —
 * they are auto-ingested from third-party feeds (GDACS → EONET → ReliefWeb) by
 * the disaster cron, so the author FK to `users` is dead. Only this column's own
 * index + FK depend on it; no other table references it (event_provinces /
 * event_stations / alert_histories / station_risk_assessments all FK to
 * disaster_events.id, which is untouched).
 */
export class DropDisasterEventsCreatedBy1739000000000
  implements MigrationInterface
{
  name = 'DropDisasterEventsCreatedBy1739000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_disaster_events_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disaster_events"
         DROP CONSTRAINT IF EXISTS "disaster_events_created_by_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disaster_events" DROP COLUMN IF EXISTS "created_by"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "disaster_events" ADD COLUMN "created_by" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "disaster_events"
         ADD CONSTRAINT "disaster_events_created_by_fkey"
         FOREIGN KEY ("created_by") REFERENCES "users" ("id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_disaster_events_created_by"
         ON "disaster_events" ("created_by")`,
    );
  }
}
