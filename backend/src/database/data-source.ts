import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

config();

/**
 * Shared TypeORM options — consumed by both the NestJS app (TypeOrmModule.forRoot)
 * and the TypeORM CLI (migrations). `synchronize` is always false: schema changes
 * go through migrations only.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'flood',
  password: process.env.DB_PASSWORD ?? 'flood_secret',
  database: process.env.DB_NAME ?? 'flood_warning',
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  // node-postgres pool tuning. Scaling horizontally: keep
  //   DB_POOL_MAX × (api instances) ≤ Postgres max_connections (default 100).
  // connectionTimeoutMillis makes a saturated pool fail fast instead of hanging.
  extra: {
    max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    connectionTimeoutMillis: parseInt(
      process.env.DB_POOL_ACQUIRE_TIMEOUT_MS ?? '3000',
      10,
    ),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
    // Opt-in: the CSV-import/report workers share this pool and a heavy report over
    // ~10k stations can run several seconds, so a global statement cap would cancel it.
    ...(process.env.DB_STATEMENT_TIMEOUT_MS
      ? { statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) }
      : {}),
  },
};

// Default export used by the TypeORM CLI: `typeorm -d dist/database/data-source.js`
const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
