import { randomUUID } from 'crypto';
import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { RedisService } from '../../redis/redis.service';
import { CreateReportDto } from './dto/create-report.dto';
import {
  REPORT_HISTORY_LIMIT,
  REPORT_JOB,
  REPORT_QUEUE,
  ReportFormat,
  ReportKind,
  reportArtifactKey,
} from './reports.constants';
import {
  ReportJobData,
  ReportMeta,
  ReportParams,
  ReportStatus,
  ReportSummary,
} from './report.types';

/** Days ahead the risk-summary window spans when the client omits from/to. */
const SUMMARY_HORIZON_DAYS = 7;

/**
 * Group H — report rendering (APIs 40–43). Mirrors the StationImportService
 * enqueue/poll shape: the request is validated + frozen into job params, the
 * heavy query + render runs in {@link ReportProcessor}, and the rendered bytes
 * land in Redis (not the job return value, which stays metadata-only). The
 * download endpoint streams those bytes back.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectQueue(REPORT_QUEUE)
    private readonly queue: Queue<ReportJobData>,
    private readonly redis: RedisService,
  ) {}

  /** API 40 — accept a report request, enqueue the render job → { jobId }. */
  async enqueueReport(
    dto: CreateReportDto,
    userId: number | null,
  ): Promise<{ jobId: string; kind: ReportKind; format: ReportFormat }> {
    const params = this.resolveParams(dto);
    const jobId = randomUUID();
    await this.queue.add(
      REPORT_JOB,
      { params, triggeredBy: userId, requestedAt: new Date().toISOString() },
      { jobId },
    );
    return { jobId, kind: params.kind, format: params.format };
  }

  /** API 41 — recent report jobs, newest first (from the queue's retained jobs). */
  async listRecent(): Promise<ReportSummary[]> {
    const jobs = await this.queue.getJobs(
      ['completed', 'active', 'waiting', 'delayed', 'failed'],
      0,
      REPORT_HISTORY_LIMIT,
    );
    const summaries = await Promise.all(
      jobs.map(async (job) => this.toSummary(job)),
    );
    return summaries.sort((a, b) =>
      (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''),
    );
  }

  /** API 42 — one job's state + progress + metadata (once completed). */
  async getStatus(jobId: string): Promise<ReportStatus> {
    const job = await this.requireJob(jobId);
    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;
    return {
      jobId,
      state,
      progress,
      meta: (job.returnvalue as ReportMeta | undefined) ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  /** API 43 — fetch the rendered artifact for streaming (or explain why not). */
  async getArtifact(
    jobId: string,
  ): Promise<{ buffer: Buffer; meta: ReportMeta }> {
    const job = await this.requireJob(jobId);
    const state = await job.getState();
    if (state !== 'completed') {
      throw new ConflictException(
        `Báo cáo chưa sẵn sàng (trạng thái: ${state}).`,
      );
    }
    const meta = job.returnvalue as ReportMeta | undefined;
    const raw = await this.redis.client.get(reportArtifactKey(jobId));
    if (!meta || raw === null) {
      // The artifact has a TTL — once it expires the job metadata may outlive it.
      throw new GoneException(
        'File báo cáo đã hết hạn tải về. Vui lòng tạo lại.',
      );
    }
    return { buffer: Buffer.from(raw, 'utf8'), meta };
  }

  // --------------------------------------------------------------------------
  // Internals.
  // --------------------------------------------------------------------------

  private async requireJob(jobId: string): Promise<Job<ReportJobData>> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Report job ${jobId} not found`);
    return job;
  }

  private async toSummary(job: Job<ReportJobData>): Promise<ReportSummary> {
    const state = await job.getState();
    return {
      jobId: job.id ?? '',
      state,
      requestedAt: job.data.requestedAt ?? null,
      triggeredBy: job.data.triggeredBy ?? null,
      params: job.data.params,
      meta: (job.returnvalue as ReportMeta | undefined) ?? null,
    };
  }

  /** Freeze the request into job params, defaulting the risk-summary window. */
  private resolveParams(dto: CreateReportDto): ReportParams {
    const params: ReportParams = {
      kind: dto.kind ?? ReportKind.STATION_INVENTORY,
      format: dto.format ?? ReportFormat.CSV,
      provinceId: dto.provinceId,
      q: dto.q?.trim() || undefined,
    };
    if (params.kind === ReportKind.RISK_SUMMARY) {
      const today = new Date();
      const end = new Date(today);
      end.setDate(end.getDate() + SUMMARY_HORIZON_DAYS);
      params.from = dto.from ?? toDateStr(today);
      params.to = dto.to ?? toDateStr(end);
    }
    return params;
  }
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
