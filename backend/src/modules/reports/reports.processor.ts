import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import {
  REPORT_ARTIFACT_TTL_SEC,
  REPORT_CONTENT_TYPE,
  REPORT_MAX_ROWS,
  REPORT_QUEUE,
  ReportFormat,
  ReportKind,
  reportArtifactKey,
} from './reports.constants';
import { ReportJobData, ReportMeta, ReportParams } from './report.types';
import { Cell, ReportTable, renderReport, SummaryStat } from './report-renderer';

const SEVERITY_LABEL: Record<string, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

/** Severity → numeric rank for "worst severity in window" aggregation/ordering. */
const SEVERITY_RANK_SQL = `CASE a.severity WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END`;
const SEVERITY_RANK_NOALIAS = `CASE severity WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END`;

/**
 * BullMQ worker for report rendering (API 40). Pulls rows for the requested
 * {@link ReportKind}, builds a neutral {@link ReportTable}, renders to CSV or HTML,
 * and stores the bytes in Redis under a TTL key. Returns metadata only.
 */
@Processor(REPORT_QUEUE)
export class ReportProcessor extends WorkerHost {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>): Promise<ReportMeta> {
    const { params } = job.data;
    await job.updateProgress(10);

    const table =
      params.kind === ReportKind.RISK_SUMMARY
        ? await this.buildRiskSummary(params)
        : await this.buildStationInventory(params);
    await job.updateProgress(60);

    const content = renderReport(table, params.format);
    const byteSize = Buffer.byteLength(content, 'utf8');
    const filename = this.filename(params);

    await this.redis.client.set(
      reportArtifactKey(job.id ?? ''),
      content,
      'EX',
      REPORT_ARTIFACT_TTL_SEC,
    );
    await job.updateProgress(100);

    return {
      kind: params.kind,
      format: params.format,
      filename,
      contentType: REPORT_CONTENT_TYPE[params.format],
      rowCount: table.rows.length,
      byteSize,
      title: table.title,
    };
  }

  // --- Kind: station inventory (StationsView export) ---

  private async buildStationInventory(
    params: ReportParams,
  ): Promise<ReportTable> {
    const where: string[] = ['s.is_deleted = false'];
    const args: unknown[] = [];
    if (params.provinceId !== undefined) {
      args.push(params.provinceId);
      where.push(`s.province_id = $${args.length}`);
    }
    if (params.q) {
      args.push(`%${params.q}%`);
      const p = `$${args.length}`;
      where.push(`(s.station_code ILIKE ${p} OR s.name ILIKE ${p} OR p.name ILIKE ${p})`);
    }
    args.push(REPORT_MAX_ROWS);

    // Thresholds + current risk are pre-aggregated per station in CTEs and LEFT
    // JOINed — far cheaper at 10k stations than a per-row LATERAL. Current risk =
    // worst severity + peak score over [today, +7].
    const rowsRaw = await this.dataSource.query<StationRow[]>(
      `WITH thr AS (
         SELECT station_id,
                MAX(CASE WHEN alert_level = 1 THEN threshold_value END) AS th1,
                MAX(CASE WHEN alert_level = 2 THEN threshold_value END) AS th2,
                MAX(CASE WHEN alert_level = 3 THEN threshold_value END) AS th3
           FROM flood_thresholds
          GROUP BY station_id
       ),
       risk AS (
         SELECT station_id,
                MAX(${SEVERITY_RANK_NOALIAS}) AS sev_rank,
                MAX(risk_score)               AS risk_score
           FROM station_risk_assessments
          WHERE forecast_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
          GROUP BY station_id
       )
       SELECT s.station_code, s.name, p.name AS province_name,
              s.latitude, s.longitude, s.elevation,
              thr.th1, thr.th2, thr.th3,
              CASE risk.sev_rank WHEN 3 THEN 'HIGH' WHEN 2 THEN 'MEDIUM' WHEN 1 THEN 'LOW' END AS risk_severity,
              risk.risk_score
         FROM stations s
         LEFT JOIN provinces p ON p.id = s.province_id
         LEFT JOIN thr  ON thr.station_id  = s.id
         LEFT JOIN risk ON risk.station_id = s.id
        WHERE ${where.join(' AND ')}
        ORDER BY s.station_code
        LIMIT $${args.length}`,
      args,
    );

    const rows: Cell[][] = rowsRaw.map((r, i) => [
      i + 1,
      r.station_code,
      r.name,
      r.province_name ?? '—',
      fmt(r.latitude, 4),
      fmt(r.longitude, 4),
      fmt(r.elevation, 1),
      fmt(r.th1, 1),
      fmt(r.th2, 1),
      fmt(r.th3, 1),
      SEVERITY_LABEL[r.risk_severity ?? ''] ?? '—',
      fmt(r.risk_score, 1),
    ]);

    return {
      title: 'Báo cáo danh sách nhà trạm',
      subtitle: this.filterCaption(params),
      generatedAt: new Date(),
      summary: [{ label: 'Tổng số trạm', value: rows.length }],
      columns: [
        'STT',
        'Mã trạm',
        'Tên trạm',
        'Tỉnh / thành',
        'Vĩ độ',
        'Kinh độ',
        'Độ cao (m)',
        'Ngưỡng 1 (m)',
        'Ngưỡng 2 (m)',
        'Ngưỡng 3 (m)',
        'Nguy cơ hiện tại',
        'Điểm rủi ro',
      ],
      rows,
    };
  }

  // --- Kind: risk summary over the forecast window ---

  private async buildRiskSummary(params: ReportParams): Promise<ReportTable> {
    const from = params.from!;
    const to = params.to!;
    const provFilter = params.provinceId !== undefined ? 's.province_id = $3' : 'TRUE';

    const baseArgs: unknown[] = [from, to];
    if (params.provinceId !== undefined) baseArgs.push(params.provinceId);

    const counts = await this.dataSource.query<{ severity: string; n: string }[]>(
      `SELECT a.severity, COUNT(DISTINCT a.station_id) AS n
         FROM station_risk_assessments a
         JOIN stations s ON s.id = a.station_id AND s.is_deleted = false
        WHERE a.forecast_date BETWEEN $1 AND $2 AND ${provFilter}
        GROUP BY a.severity`,
      baseArgs,
    );
    const countOf = (sev: string) =>
      Number(counts.find((c) => c.severity === sev)?.n ?? 0);

    const rankArgs = [...baseArgs, REPORT_MAX_ROWS];
    const rowsRaw = await this.dataSource.query<RiskRow[]>(
      `SELECT DISTINCT ON (a.station_id)
              s.station_code, s.name, p.name AS province_name,
              a.severity, a.risk_score, a.forecast_date,
              a.predicted_water_level, a.threshold_value, a.is_exceeded
         FROM station_risk_assessments a
         JOIN stations s ON s.id = a.station_id AND s.is_deleted = false
         LEFT JOIN provinces p ON p.id = s.province_id
        WHERE a.forecast_date BETWEEN $1 AND $2 AND ${provFilter}
          AND a.severity <> 'LOW'
        ORDER BY a.station_id, ${SEVERITY_RANK_SQL} DESC, a.risk_score DESC NULLS LAST
        LIMIT $${rankArgs.length}`,
      rankArgs,
    );

    // DISTINCT ON forced station_id ordering; re-sort by severity for display.
    rowsRaw.sort(
      (x, y) =>
        sevRank(y.severity) - sevRank(x.severity) ||
        Number(y.risk_score ?? 0) - Number(x.risk_score ?? 0),
    );

    const rows: Cell[][] = rowsRaw.map((r, i) => [
      i + 1,
      r.station_code,
      r.name,
      r.province_name ?? '—',
      SEVERITY_LABEL[r.severity ?? ''] ?? '—',
      fmt(r.risk_score, 1),
      r.forecast_date,
      fmt(r.predicted_water_level, 2),
      fmt(r.threshold_value, 2),
      r.is_exceeded ? 'Có' : 'Không',
    ]);

    const summary: SummaryStat[] = [
      { label: 'Nguy cơ cao', value: countOf('HIGH') },
      { label: 'Nguy cơ trung bình', value: countOf('MEDIUM') },
      { label: 'Trạm nguy cơ (≥ TB)', value: rows.length },
    ];

    return {
      title: 'Báo cáo tổng hợp nguy cơ ngập',
      subtitle: `Cửa sổ dự báo ${from} → ${to}${
        params.provinceId !== undefined ? ` · ${this.filterCaption(params)}` : ''
      }`,
      generatedAt: new Date(),
      summary,
      columns: [
        'STT',
        'Mã trạm',
        'Tên trạm',
        'Tỉnh / thành',
        'Mức độ',
        'Điểm rủi ro',
        'Ngày dự báo',
        'Mực nước dự báo (m)',
        'Ngưỡng (m)',
        'Vượt ngưỡng',
      ],
      rows,
    };
  }

  // --- Helpers ---

  private filterCaption(params: ReportParams): string {
    const bits: string[] = [];
    bits.push(
      params.provinceId !== undefined
        ? `Tỉnh #${params.provinceId}`
        : 'Tất cả tỉnh/thành',
    );
    if (params.q) bits.push(`từ khóa "${params.q}"`);
    return bits.join(' · ');
  }

  private filename(params: ReportParams): string {
    const stamp = new Date().toISOString().slice(0, 10);
    const base =
      params.kind === ReportKind.RISK_SUMMARY
        ? 'bao-cao-nguy-co'
        : 'bao-cao-danh-sach-tram';
    const ext = params.format === ReportFormat.HTML ? 'html' : 'csv';
    return `${base}_${stamp}.${ext}`;
  }
}

interface StationRow {
  station_code: string;
  name: string;
  province_name: string | null;
  latitude: string | null;
  longitude: string | null;
  elevation: string | null;
  th1: string | null;
  th2: string | null;
  th3: string | null;
  risk_severity: string | null;
  risk_score: string | null;
}

interface RiskRow {
  station_code: string;
  name: string;
  province_name: string | null;
  severity: string | null;
  risk_score: string | null;
  forecast_date: string;
  predicted_water_level: string | null;
  threshold_value: string | null;
  is_exceeded: boolean;
}

function sevRank(sev: string | null): number {
  return sev === 'HIGH' ? 3 : sev === 'MEDIUM' ? 2 : sev === 'LOW' ? 1 : 0;
}

/** Format a numeric DB string to fixed decimals; em-dash for null/non-finite. */
function fmt(v: string | number | null, digits: number): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
