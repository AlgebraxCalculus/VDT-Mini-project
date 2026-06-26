import { ValueTransformer } from 'typeorm';

/**
 * Converts Postgres `numeric`/`decimal` columns to JS `number` on read.
 *
 * TypeORM returns decimals as strings (to avoid silent float precision loss).
 * For this domain — coordinates, elevation, rainfall, thresholds, risk scores —
 * `number` is the natural type, so we transform on the way out and pass values
 * straight through on the way in.
 *
 * NOTE: do NOT use this for `bigint` primary/foreign keys — those stay `string`
 * to preserve values beyond 2^53.
 */
export class DecimalTransformer implements ValueTransformer {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  }

  from(value: string | null): number | null {
    return value === null || value === undefined ? null : parseFloat(value);
  }
}

/** Shared singleton — these transformers are stateless. */
export const decimalTransformer = new DecimalTransformer();
