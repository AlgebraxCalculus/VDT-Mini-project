/** BullMQ queue + job names for async station import (API 18). */
export const STATION_IMPORT_QUEUE = 'stations-import';
export const STATION_IMPORT_JOB = 'import';

/** Rows committed per transaction (design: ~1.000 records/transaction). */
export const IMPORT_BATCH_SIZE = 1000;

/** Hard cap on rows accepted per upload (design: ≤10.000 dòng/lần). */
export const IMPORT_MAX_ROWS = 10000;

/** Upload size guard (~5 MB easily covers 10k station rows). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Cap on per-row errors carried in the report (keeps the Redis return value small). */
export const IMPORT_ERROR_CAP = 500;
