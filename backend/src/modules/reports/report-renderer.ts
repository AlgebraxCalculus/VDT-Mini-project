import { ReportFormat } from './reports.constants';

/** A renderable cell value — coerced to a display string by the renderers. */
export type Cell = string | number | null | undefined;

/** One labelled KPI shown above the table (e.g. severity counts). */
export interface SummaryStat {
  label: string;
  value: string | number;
}

/**
 * Format-agnostic report model the processor builds per {@link ReportKind}. The
 * two renderers below turn it into CSV (data) or a print-ready HTML document
 * (browser → PDF). Keeping this neutral means a new format is one more renderer,
 * not a rewrite of the query layer.
 */
export interface ReportTable {
  title: string;
  subtitle: string;
  generatedAt: Date;
  summary: SummaryStat[];
  columns: string[];
  rows: Cell[][];
}

const cellText = (c: Cell): string => (c === null || c === undefined ? '' : String(c));

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Quote a field only when it contains a comma, quote, or newline (RFC 4180). */
function csvField(value: Cell): string {
  const s = cellText(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvRow = (cells: Cell[]): string => cells.map(csvField).join(',');

/**
 * Render to CSV with a small human header (title + timestamp + KPIs), a blank
 * line, then the data table. A leading BOM makes Excel open UTF-8 (Vietnamese)
 * correctly.
 */
export function renderCsv(table: ReportTable): string {
  const lines: string[] = [];
  lines.push(csvRow([table.title]));
  lines.push(csvRow([table.subtitle]));
  lines.push(csvRow(['Xuất lúc', table.generatedAt.toISOString()]));
  if (table.summary.length > 0) {
    lines.push('');
    for (const s of table.summary) lines.push(csvRow([s.label, s.value]));
  }
  lines.push('');
  lines.push(csvRow(table.columns));
  for (const row of table.rows) lines.push(csvRow(row));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// HTML (print-ready → PDF / Word)
// ---------------------------------------------------------------------------

function htmlEscape(value: Cell): string {
  return cellText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render to a single self-contained HTML document with A4 print styling. The
 * frontend opens it and triggers the browser's print dialog (→ Save as PDF), so
 * "Xuất PDF" needs no server-side PDF engine. Word can also open the file.
 */
export function renderHtml(table: ReportTable): string {
  const summaryCards = table.summary
    .map(
      (s) => `<div class="kpi"><div class="kpi-v">${htmlEscape(
        String(s.value),
      )}</div><div class="kpi-l">${htmlEscape(s.label)}</div></div>`,
    )
    .join('');

  const head = table.columns.map((c) => `<th>${htmlEscape(c)}</th>`).join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${htmlEscape(c)}</td>`).join('')}</tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>${htmlEscape(table.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #16181D; margin: 28px; font-size: 12px; }
  header { border-bottom: 3px solid #EE0033; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0 0 4px; font-size: 19px; color: #16181D; }
  .sub { color: #6B7280; font-size: 12.5px; }
  .meta { color: #9AA0A6; font-size: 11px; margin-top: 4px; }
  .kpis { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .kpi { border: 1px solid #E8EAEE; border-radius: 10px; padding: 10px 16px; min-width: 120px; }
  .kpi-v { font-size: 22px; font-weight: 800; color: #EE0033; }
  .kpi-l { font-size: 11px; color: #6B7280; margin-top: 2px; text-transform: uppercase; letter-spacing: .3px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #FAFBFC; text-align: left; padding: 7px 9px; border-bottom: 2px solid #EEF0F3; color: #6B7280; text-transform: uppercase; font-size: 10px; letter-spacing: .2px; }
  td { padding: 6px 9px; border-bottom: 1px solid #F2F3F5; }
  tr:nth-child(even) td { background: #FCFCFD; }
  footer { margin-top: 18px; color: #9AA0A6; font-size: 10.5px; text-align: right; }
  @media print { body { margin: 0; } @page { size: A4; margin: 14mm; } }
</style>
</head>
<body>
  <header>
    <h1>${htmlEscape(table.title)}</h1>
    <div class="sub">${htmlEscape(table.subtitle)}</div>
    <div class="meta">Xuất lúc ${htmlEscape(
      table.generatedAt.toLocaleString('vi-VN'),
    )} · ${table.rows.length} dòng</div>
  </header>
  ${table.summary.length ? `<div class="kpis">${summaryCards}</div>` : ''}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <footer>Hệ thống cảnh báo nguy cơ ngập lụt trạm viễn thông — báo cáo tự sinh.</footer>
</body>
</html>`;
}

/** Render the neutral table model to the requested format. */
export function renderReport(table: ReportTable, format: ReportFormat): string {
  return format === ReportFormat.HTML ? renderHtml(table) : renderCsv(table);
}
