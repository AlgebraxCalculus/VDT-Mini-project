import { randomUUID } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import {
  SnapshotTrigger,
  WeatherSnapshot,
  WeatherSource,
} from './entities/weather-snapshot.entity';
import {
  REFRESH_LAST_KEY,
  REFRESH_LOCK_KEY,
  WEATHER_JOB,
  WEATHER_QUEUE,
} from './weather.constants';
import { RefreshWeatherDto } from './dto/refresh-weather.dto';

/** Job payload carried on the BullMQ queue (consumed by WeatherProcessor). */
export interface WeatherJobData {
  trigger: SnapshotTrigger;
  triggeredBy: number | null;
  stationIds?: number[];
  provinceIds?: number[];
  source?: WeatherSource;
}

/**
 * Group F orchestration: enqueue ingestion jobs (with a Redis debounce lock for
 * manual refresh), report job status, and serve the latest snapshot. The heavy
 * work runs in {@link WeatherProcessor}; this layer only marshals + guards.
 */
@Injectable()
export class WeatherService {
  private readonly lockTtlMs: number;

  constructor(
    @InjectQueue(WEATHER_QUEUE) private readonly queue: Queue<WeatherJobData>,
    @InjectRepository(WeatherSnapshot)
    private readonly snapshotsRepo: Repository<WeatherSnapshot>,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.lockTtlMs = parseInt(
      this.config.get<string>('WEATHER_REFRESH_LOCK_TTL_MS') ?? '30000',
      10,
    );
  }

  /** API 31 — manual refresh: acquire debounce lock, then enqueue. */
  async enqueueRefresh(
    dto: RefreshWeatherDto,
    userId: number,
  ): Promise<{ jobId: string }> {
    const jobId = randomUUID();

    // SET key value NX PX ttl — only one refresh in flight per debounce window.
    const acquired = await this.redis.client.set(
      REFRESH_LOCK_KEY,
      jobId,
      'PX',
      this.lockTtlMs,
      'NX',
    );
    if (!acquired) {
      const inflight = await this.redis.client.get(REFRESH_LAST_KEY);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'A weather refresh is already running; please wait.',
          jobId: inflight ?? undefined,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redis.client.set(REFRESH_LAST_KEY, jobId, 'PX', this.lockTtlMs);

    await this.queue.add(
      WEATHER_JOB.REFRESH,
      {
        trigger: SnapshotTrigger.MANUAL,
        triggeredBy: userId,
        stationIds: dto.stationIds,
        provinceIds: dto.provinceIds,
        source: dto.source,
      },
      { jobId },
    );
    return { jobId };
  }

  /** API 34 — scheduled ingestion (also called by the cron service). */
  async enqueueIngest(): Promise<{ jobId: string }> {
    const job = await this.queue.add(WEATHER_JOB.INGEST, {
      trigger: SnapshotTrigger.SCHEDULED,
      triggeredBy: null,
    });
    return { jobId: String(job.id) };
  }

  /** API 32 — job status + resulting snapshot id. */
  async getRefreshStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    snapshotId: string | null;
    failedReason: string | null;
  }> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    const state = await job.getState();
    const snapshotId =
      (job.returnvalue as { snapshotId?: string } | undefined)?.snapshotId ??
      null;
    return {
      jobId,
      state,
      snapshotId,
      failedReason: job.failedReason ?? null,
    };
  }

  /** API 33 — latest stored snapshot (optionally filtered by source). */
  async getLatestSnapshot(source?: WeatherSource): Promise<WeatherSnapshot> {
    const snapshot = await this.snapshotsRepo.findOne({
      where: source ? { sourceCode: source } : {},
      order: { fetchedAt: 'DESC' },
    });
    if (!snapshot) {
      throw new NotFoundException('No weather snapshot available yet');
    }
    return snapshot;
  }

  /** Release the manual-refresh lock (called by the processor when done). */
  async releaseRefreshLock(jobId: string): Promise<void> {
    const holder = await this.redis.client.get(REFRESH_LOCK_KEY);
    if (holder === jobId) {
      await this.redis.client.del(REFRESH_LOCK_KEY);
    }
  }
}
