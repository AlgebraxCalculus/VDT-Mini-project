import { ReportFormat, ReportKind } from './reports.constants';

/** The resolved filter set carried on the queue (a frozen copy of the request). */
export interface ReportParams {
  kind: ReportKind;
  format: ReportFormat;
  provinceId?: number;
  q?: string;
  /** Inclusive forecast-window bounds (YYYY-MM-DD) — risk-summary only. */
  from?: string;
  to?: string;
}

/** Job payload placed on the BullMQ queue (API 40 → worker). */
export interface ReportJobData {
  params: ReportParams;
  triggeredBy: number | null;
  /** When the request was accepted (ISO) — surfaced in the history list. */
  requestedAt: string;
}

/**
 * Metadata the worker returns (job.returnvalue). The bytes themselves live in
 * Redis under {@link reportArtifactKey}; this stays small so the history list and
 * status poll are cheap.
 */
export interface ReportMeta {
  kind: ReportKind;
  format: ReportFormat;
  filename: string;
  contentType: string;
  /** Number of data rows rendered (stations, or ranked at-risk stations). */
  rowCount: number;
  /** Byte size of the rendered artifact. */
  byteSize: number;
  /** Human title shown in the document + history list. */
  title: string;
}

/** API 42 — one report job's live state. */
export interface ReportStatus {
  jobId: string;
  state: string; // waiting | active | completed | failed | …
  progress: number; // 0–100
  meta: ReportMeta | null; // present once state = completed
  failedReason: string | null;
}

/** API 41 — one row of the recent-reports history. */
export interface ReportSummary {
  jobId: string;
  state: string;
  requestedAt: string | null;
  triggeredBy: number | null;
  params: ReportParams;
  meta: ReportMeta | null;
}
