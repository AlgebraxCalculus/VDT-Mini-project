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
};

// Default export used by the TypeORM CLI: `typeorm -d dist/database/data-source.js`
const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
