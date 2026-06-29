import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WeatherSource } from '../entities/weather-snapshot.entity';
import { HealthCheckable } from './weather-provider.interface';

/** A station's coordinates, for nearest-grid-cell river extraction. */
export interface RiverTarget {
  stationId: number;
  latitude: number;
  longitude: number;
}

/** One day of river discharge (m³/s) for a station. */
export interface RiverDaily {
  date: string; // YYYY-MM-DD
  discharge: number;
}

/**
 * GloFAS (Copernicus EWDS) river-discharge source — the reachable replacement for
 * the network-blocked Open-Meteo Flood API. NOT a forecast provider: it returns a
 * gridded GRIB2 field once per day, so it runs on its own daily cadence
 * ({@link GlofasService}), not the hourly forecast chain.
 *
 * Flow (OGC API – Processes over plain fetch): submit `cems-glofas-forecast` for a
 * bbox → poll the async job → download GRIB2 → extract each station's nearest grid
 * cell via a Python sidecar (cfgrib/xarray). Auth is the EWDS Personal Access Token
 * sent as the `PRIVATE-TOKEN` header; the source is skipped if EWDS_PAT is unset.
 *
 * UNITS: GloFAS yields river DISCHARGE (m³/s). This provider returns it raw;
 * {@link GlofasService} converts it to a water-level STAGE (m) on each station's
 * own flood-threshold scale (a self-anchored rating curve) before persisting.
 */
@Injectable()
export class GlofasProvider implements HealthCheckable {
  readonly code = WeatherSource.GLOFAS;
  readonly requiresKey = true; // the EWDS PAT acts as the key

  private readonly logger = new Logger(GlofasProvider.name);
  private readonly base: string;
  private readonly pat?: string;
  private readonly area: number[]; // [North, West, South, East]
  private readonly extractCmd: string;
  private readonly leadtimeHours: string[];

  constructor(private readonly config: ConfigService) {
    this.base =
      this.config.get<string>('EWDS_URL') ??
      'https://ewds.climate.copernicus.eu/api/retrieve/v1';
    this.pat = this.config.get<string>('EWDS_PAT') || undefined;
    this.area = (this.config.get<string>('GLOFAS_AREA') ?? '24,102,8,110')
      .split(',')
      .map((n) => Number(n.trim()));
    this.extractCmd =
      this.config.get<string>('GLOFAS_EXTRACT_CMD') ??
      'python3 scripts/glofas_extract.py';
    const days = parseInt(
      this.config.get<string>('WEATHER_FORECAST_DAYS') ?? '7',
      10,
    );
    // GloFAS forecast leadtimes are daily steps of 24h.
    this.leadtimeHours = Array.from({ length: days }, (_, i) =>
      String((i + 1) * 24),
    );
  }

  isConfigured(): boolean {
    return !!this.pat;
  }

  private timeoutMs(): number {
    return parseInt(
      this.config.get<string>('WEATHER_HTTP_TIMEOUT_MS') ?? '25000',
      10,
    );
  }

  private authHeaders(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.pat ?? '',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** fetch with an AbortController timeout (EWDS jobs are async, calls are short). */
  private async fetchT(url: string, init: RequestInit, ms = this.timeoutMs()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Liveness probe — reachability of the GloFAS process catalogue entry. */
  async ping(timeoutMs?: number): Promise<number> {
    const started = Date.now();
    const res = await this.fetchT(
      `${this.base}/processes/cems-glofas-forecast`,
      { headers: { Accept: 'application/json' } },
      timeoutMs ?? this.timeoutMs(),
    );
    if (!res.ok) throw new Error(`GloFAS process catalogue HTTP ${res.status}`);
    return Date.now() - started;
  }

  /**
   * Full daily pull: submit → poll → download GRIB → extract per-station discharge.
   * Returns a map stationId → daily river-discharge series. Throws on EWDS failure;
   * a missing/failed Python sidecar yields an empty map with a logged warning
   * (see note.txt — the GRIB-extraction sidecar dependency is the open gap).
   */
  async fetchRiverDischarge(
    targets: RiverTarget[],
    date = new Date(),
  ): Promise<Map<number, RiverDaily[]>> {
    if (!this.pat) throw new Error('GloFAS: EWDS_PAT not configured');
    const jobId = await this.submit(date);
    this.logger.log(`GloFAS job ${jobId} submitted; polling…`);
    await this.pollUntilDone(jobId);
    const href = await this.resolveAsset(jobId);

    const dir = await mkdtemp(join(tmpdir(), 'glofas-'));
    const gribPath = join(dir, 'glofas.grib2');
    try {
      await this.download(href, gribPath);
      return await this.extractPerStation(gribPath, targets);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async submit(date: Date): Promise<string> {
    const body = {
      inputs: {
        system_version: 'operational',
        hydrological_model: 'lisflood',
        product_type: 'control_forecast',
        variable: 'river_discharge_in_the_last_24_hours',
        year: String(date.getUTCFullYear()),
        month: String(date.getUTCMonth() + 1).padStart(2, '0'),
        day: String(date.getUTCDate()).padStart(2, '0'),
        leadtime_hour: this.leadtimeHours,
        data_format: 'grib2',
        download_format: 'unarchived',
        area: this.area,
      },
    };
    const res = await this.fetchT(
      `${this.base}/processes/cems-glofas-forecast/execution`,
      { method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body) },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`GloFAS submit HTTP ${res.status}: ${text.slice(0, 200)}`);
    const job = JSON.parse(text) as { jobID?: string; id?: string };
    const jobId = job.jobID ?? job.id;
    if (!jobId) throw new Error(`GloFAS submit: no job id in ${text.slice(0, 120)}`);
    return jobId;
  }

  private async pollUntilDone(
    jobId: string,
    { tries = 90, intervalMs = 10000 } = {},
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      const res = await this.fetchT(`${this.base}/jobs/${jobId}`, {
        headers: this.authHeaders(),
      });
      const job = (await res.json()) as { status?: string };
      if (job.status === 'successful') return;
      if (job.status === 'failed') throw new Error(`GloFAS job ${jobId} failed`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`GloFAS job ${jobId} did not finish in time`);
  }

  private async resolveAsset(jobId: string): Promise<string> {
    const res = await this.fetchT(`${this.base}/jobs/${jobId}/results`, {
      headers: this.authHeaders(),
    });
    const results = (await res.json()) as {
      asset?: { value?: { href?: string }; href?: string };
    };
    const href = results.asset?.value?.href ?? results.asset?.href;
    if (!href) throw new Error('GloFAS: no asset href in job results');
    return href;
  }

  private async download(href: string, outPath: string): Promise<void> {
    const res = await this.fetchT(
      href,
      { headers: { 'PRIVATE-TOKEN': this.pat ?? '' } },
      this.timeoutMs() * 3, // the GRIB can be a few MB
    );
    if (!res.ok) throw new Error(`GloFAS download HTTP ${res.status}`);
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  }

  /**
   * Spawn the Python sidecar to map GRIB grid cells → stations. The sidecar reads
   * the GRIB path + a stations JSON (stdin) and prints {stationId: [{date,discharge}]}.
   * Pure-Node GRIB decoding is impractical, hence the sidecar (cfgrib/xarray).
   */
  private extractPerStation(
    gribPath: string,
    targets: RiverTarget[],
  ): Promise<Map<number, RiverDaily[]>> {
    const [cmd, ...args] = this.extractCmd.split(' ');
    return new Promise((resolve) => {
      const child = execFile(
        cmd,
        [...args, gribPath],
        { timeout: 180000, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            // Don't crash the app — skip river enrichment this run, but surface the
            // sidecar's stderr so the real cause is visible (deps, GRIB, timeout…).
            this.logger.warn(
              `GloFAS extraction failed: ${err.message}${
                stderr ? ` | stderr: ${String(stderr).slice(0, 300)}` : ''
              }`,
            );
            return resolve(new Map());
          }
          try {
            const parsed = JSON.parse(stdout) as Record<string, RiverDaily[]>;
            const map = new Map<number, RiverDaily[]>();
            for (const [sid, series] of Object.entries(parsed)) {
              map.set(Number(sid), series);
            }
            resolve(map);
          } catch (e) {
            this.logger.warn(
              `GloFAS extraction parse failed: ${(e as Error).message}`,
            );
            resolve(new Map());
          }
        },
      );
      child.stdin?.end(JSON.stringify(targets));
    });
  }
}
