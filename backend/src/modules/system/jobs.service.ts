import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { WEATHER_QUEUE } from '../weather/weather.constants';
import { REPORT_QUEUE } from '../reports/reports.constants';
import { STATION_IMPORT_QUEUE } from '../stations/import/station-import.constants';
import { JobQueueName, JobState, RecentJob } from './system.types';

/** Lifecycle states worth surfacing — newest of these across all queues wins. */
const STATES = ['active', 'completed', 'failed', 'waiting', 'delayed'] as const;

/** How many jobs to pull per queue before the global newest-first merge. */
const FETCH_PER_QUEUE = 25;

/** Internal carrier: a {@link RecentJob} plus the epoch ms used to sort it. */
type SortableJob = RecentJob & { _sortMs: number };

/**
 * Aggregates recent BullMQ jobs across the weather / reports / stations-import
 * queues for the Health dashboard ("Tác vụ nền gần đây"). Read-only: it
 * re-registers the three queues purely as clients (see {@link SystemModule}) —
 * it never adds or processes jobs, so it owns no defaultJobOptions or worker.
 */
@Injectable()
export class JobsService {
  private readonly queues: { name: JobQueueName; queue: Queue }[];

  constructor(
    @InjectQueue(WEATHER_QUEUE) weather: Queue,
    @InjectQueue(REPORT_QUEUE) reports: Queue,
    @InjectQueue(STATION_IMPORT_QUEUE) imports: Queue,
  ) {
    this.queues = [
      { name: 'weather', queue: weather },
      { name: 'reports', queue: reports },
      { name: 'stations-import', queue: imports },
    ];
  }

  /** Recent jobs across all queues, newest first, capped at `limit`. */
  async getRecentJobs(limit: number): Promise<RecentJob[]> {
    const batches = await Promise.all(
      this.queues.map(({ name, queue }) => this.collect(name, queue)),
    );
    return batches
      .flat()
      .sort((a, b) => b._sortMs - a._sortMs)
      .slice(0, limit)
      .map(({ _sortMs: _, ...job }) => job);
  }

  /** Pull + flatten one queue's recent jobs (best-effort — a queue error → []). */
  private async collect(
    name: JobQueueName,
    queue: Queue,
  ): Promise<SortableJob[]> {
    const jobs = await queue
      .getJobs([...STATES], 0, FETCH_PER_QUEUE - 1, false)
      .catch(() => [] as Job[]);
    return Promise.all(jobs.map((job) => this.toRecent(name, job)));
  }

  private async toRecent(name: JobQueueName, job: Job): Promise<SortableJob> {
    const state = (await job.getState().catch(() => 'unknown')) as JobState;
    const progress = typeof job.progress === 'number' ? job.progress : 0;
    // Sort by the latest lifecycle timestamp the job has reached.
    const sortMs = job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0;
    return {
      id: String(job.id ?? ''),
      queue: name,
      name: job.name,
      state,
      progress: Math.round(progress),
      attemptsMade: job.attemptsMade ?? 0,
      createdAt: toIso(job.timestamp),
      startedAt: toIso(job.processedOn),
      finishedAt: toIso(job.finishedOn),
      failedReason: job.failedReason ?? null,
      _sortMs: sortMs,
    };
  }
}

function toIso(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}
