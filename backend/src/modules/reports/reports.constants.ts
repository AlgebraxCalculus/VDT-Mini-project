/** BullMQ queue + job names for async report rendering (Group H, API 40). */
export const REPORT_QUEUE = 'reports';
export const REPORT_JOB = 'render';

/** Redis key (under RedisService.client) holding a finished report's bytes. */
export const reportArtifactKey = (jobId: string) => `report:artifact:${jobId}`;

/** How long a rendered artifact stays downloadable (seconds). */
export const REPORT_ARTIFACT_TTL_SEC = 60 * 60; // 1 hour

/** Cap on rows pulled into one report (keeps render + Redis payload bounded). */
export const REPORT_MAX_ROWS = 10000;

/** How many recent jobs the history list (API 41) returns. */
export const REPORT_HISTORY_LIMIT = 50;

/** What the report is about. */
export enum ReportKind {
  /** Station inventory + current risk — the StationsView export (honors province/q). */
  STATION_INVENTORY = 'station-inventory',
  /** At-risk summary over the forecast window (severity counts + ranked stations). */
  RISK_SUMMARY = 'risk-summary',
}

/** Rendered output format. `html` is print-ready (browser → PDF); `csv` is data. */
export enum ReportFormat {
  CSV = 'csv',
  HTML = 'html',
}

/** Content-Type per format (Content-Disposition is built with the filename). */
export const REPORT_CONTENT_TYPE: Record<ReportFormat, string> = {
  [ReportFormat.CSV]: 'text/csv; charset=utf-8',
  [ReportFormat.HTML]: 'text/html; charset=utf-8',
};
