import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { HEALTH_KEY_PREFIX, HEALTH_PROVIDERS } from './weather.constants';
import { HealthCheckable } from './providers/weather-provider.interface';

/** Last-known health of one external source (API 35 payload item). */
export interface SourceHealth {
  code: string;
  configured: boolean;
  status: 'UP' | 'DOWN' | 'UNKNOWN';
  latencyMs: number | null;
  /** Rolling failure ratio since process start (fails / total checks). */
  errorRate: number;
  error: string | null;
  checkedAt: string | null;
}

/**
 * Pings each external source on a schedule and caches the result in Redis so
 * API 35 can read it directly (per design: "read healthcheck straight from
 * Redis"). Keeps rolling success/total counters per source for an error rate.
 */
@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);

  /** Shorter timeout than data fetches so a blocked source doesn't stall checks. */
  private readonly pingTimeoutMs: number;

  constructor(
    @Inject(HEALTH_PROVIDERS)
    private readonly providers: HealthCheckable[],
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.pingTimeoutMs = parseInt(
      this.config.get<string>('WEATHER_PING_TIMEOUT_MS') ?? '5000',
      10,
    );
  }

  /** Probe every source and persist results. Called by the healthcheck cron. */
  async runChecks(): Promise<void> {
    await Promise.all(this.providers.map((p) => this.check(p)));
  }

  private async check(provider: HealthCheckable): Promise<void> {
    const key = HEALTH_KEY_PREFIX + provider.code;

    if (!provider.isConfigured()) {
      await this.write(key, {
        code: provider.code,
        configured: false,
        status: 'UNKNOWN',
        latencyMs: null,
        errorRate: 0,
        error: 'not configured (missing API key)',
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    let latencyMs: number | null = null;
    let error: string | null = null;
    try {
      latencyMs = await provider.ping(this.pingTimeoutMs);
    } catch (err) {
      // Node's global fetch wraps every network-level failure in a generic
      // "fetch failed" — the actionable reason (ETIMEDOUT, ENETUNREACH, DNS,
      // IPv6 unroutable, TLS…) lives in err.cause. Surface it so API 35 shows
      // *why* a source is DOWN instead of an opaque "fetch failed".
      error = describeError(err);
    }

    const ok = error === null;
    const { total, fails } = await this.bumpCounters(provider.code, ok);

    await this.write(key, {
      code: provider.code,
      configured: true,
      status: ok ? 'UP' : 'DOWN',
      latencyMs,
      errorRate: total > 0 ? Number((fails / total).toFixed(3)) : 0,
      error,
      checkedAt: new Date().toISOString(),
    });
  }

  private async bumpCounters(
    code: string,
    ok: boolean,
  ): Promise<{ total: number; fails: number }> {
    const totalKey = `${HEALTH_KEY_PREFIX}${code}:total`;
    const failKey = `${HEALTH_KEY_PREFIX}${code}:fail`;
    const total = await this.redis.client.incr(totalKey);
    const fails = ok
      ? Number((await this.redis.client.get(failKey)) ?? 0)
      : await this.redis.client.incr(failKey);
    return { total, fails };
  }

  private async write(key: string, value: SourceHealth): Promise<void> {
    await this.redis.client.set(key, JSON.stringify(value));
  }

  // describeError lives at module scope (below the class).

  /** Read the latest cached health of every source (API 35). */
  async getAll(): Promise<SourceHealth[]> {
    const results: SourceHealth[] = [];
    for (const provider of this.providers) {
      const raw = await this.redis.client.get(HEALTH_KEY_PREFIX + provider.code);
      if (raw) {
        results.push(JSON.parse(raw) as SourceHealth);
      } else {
        results.push({
          code: provider.code,
          configured: provider.isConfigured(),
          status: 'UNKNOWN',
          latencyMs: null,
          errorRate: 0,
          error: 'no check has run yet',
          checkedAt: null,
        });
      }
    }
    return results;
  }
}

/**
 * Build a human-readable error string, unwrapping the `cause` chain that Node's
 * global fetch hides behind a generic "fetch failed". Surfaces codes like
 * ETIMEDOUT / ENETUNREACH / ENOTFOUND so a DOWN source is actually diagnosable.
 */
function describeError(err: unknown): string {
  const e = err as { message?: string; code?: string; cause?: unknown } | null;
  const parts: string[] = [];
  if (e?.message) parts.push(e.message);
  let cause: unknown = e?.cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const c = cause as { message?: string; code?: string; cause?: unknown };
    const detail = c.code ?? c.message;
    if (detail && !parts.includes(detail)) parts.push(detail);
    cause = c.cause;
  }
  return parts.join(': ') || String(err);
}
