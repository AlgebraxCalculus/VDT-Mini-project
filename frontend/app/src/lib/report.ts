// Shared Group H report export (APIs 40–43): create → poll → deliver, used by
// StationsView and ForecastView.

import { ApiError, apiCreateReport, apiDownloadReport, apiGetReportJob } from './api';
import type { CreateReportPayload, ReportMeta } from './api';

/** Poll a report job (API 42) until it completes; resolves its metadata or throws. */
export async function pollReportJob(jobId: string, timeoutMs = 60000): Promise<ReportMeta> {
  const started = Date.now();
  for (;;) {
    const status = await apiGetReportJob(jobId);
    if (status.state === 'completed' && status.meta) return status.meta;
    if (status.state === 'failed') {
      throw new ApiError(500, status.failedReason ?? 'Tạo báo cáo thất bại.');
    }
    if (Date.now() - started > timeoutMs) {
      throw new ApiError(0, 'Tạo báo cáo quá thời gian chờ. Vui lòng thử lại.');
    }
    await new Promise((r) => setTimeout(r, 600));
  }
}

/** Trigger a browser download of a Blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open a print-ready HTML report in a new tab and fire the print dialog (→ PDF). */
export function printHtmlBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) {
    w.onload = () => {
      w.focus();
      w.print();
    };
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export type ReportDelivery = 'download' | 'print';

/**
 * Create (API 40) → poll (API 42) → download (API 43) a report, then deliver it:
 * `download` saves the file, `print` prints the HTML (→ PDF). `filenameOverride`
 * lets a caller save under a different name/ext (e.g. HTML as `.doc` for "Word").
 */
export async function exportReport(
  payload: CreateReportPayload,
  delivery: ReportDelivery,
  filenameOverride?: string,
): Promise<ReportMeta> {
  const { jobId } = await apiCreateReport(payload);
  const meta = await pollReportJob(jobId);
  const { blob, filename } = await apiDownloadReport(jobId);
  if (delivery === 'print') printHtmlBlob(blob);
  else downloadBlob(blob, filenameOverride ?? filename);
  return meta;
}
