import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../../event-bus/event-bus.constants';
import { ProvinceResolverService } from '../../provinces/province-resolver.service';
import { AlertLevel, FloodThreshold } from '../entities/flood-threshold.entity';
import { Station } from '../entities/station.entity';
import {
  IMPORT_BATCH_SIZE,
  IMPORT_ERROR_CAP,
  STATION_IMPORT_QUEUE,
} from './station-import.constants';
import {
  ImportRecord,
  ImportReport,
  ImportRowError,
  StationImportJobData,
} from './station-import.service';

const STATION_CODE_RE = /^[A-Za-z0-9_-]+$/;

/** A validated, insert-ready station row. */
interface ValidRow {
  stationCode: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  tiers: { alertLevel: AlertLevel; thresholdValue: number }[];
}

/**
 * BullMQ worker for station import (API 18). Loads existing codes once, then walks
 * the records in batches of {@link IMPORT_BATCH_SIZE}, each batch wrapped in its own
 * transaction. Invalid rows are skipped + collected into the report (they don't
 * abort the batch); valid rows are inserted with geom + ST_Contains province
 * assignment (same statement as StationsService.create). The job does not retry
 * (attempts: 1) because re-running it would re-evaluate already-committed batches.
 */
@Processor(STATION_IMPORT_QUEUE)
export class StationImportProcessor extends WorkerHost {
  private readonly logger = new Logger(StationImportProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    // Resolves (and auto-creates, via geocoding) the province per coordinate —
    // so imported stations outside the seeded provinces still get a province_id.
    private readonly provinceResolver: ProvinceResolverService,
  ) {
    super();
  }

  async process(job: Job<StationImportJobData>): Promise<ImportReport> {
    const { records } = job.data;
    const total = records.length;

    // station_code is UNIQUE across all rows (incl. soft-deleted) — pre-load the
    // set once so duplicate detection is a memory lookup, not a query per row.
    const existing = await this.loadExistingCodes();
    const seen = new Set<string>(); // in-file duplicates

    const errors: ImportRowError[] = [];
    const thresholdStationIds: number[] = [];
    let success = 0;
    let processed = 0;

    for (let start = 0; start < total; start += IMPORT_BATCH_SIZE) {
      const batch = records.slice(start, start + IMPORT_BATCH_SIZE);

      // Pre-pass (no transaction): validate, then resolve each province. Province
      // resolution may reverse-geocode + create a province, so it must NOT run
      // inside the insert transaction (a network call would hold the DB lock and,
      // at 1 req/s, keep it open for minutes).
      const ready: { row: ValidRow; provinceId: number | null }[] = [];
      for (const rec of batch) {
        const result = this.validate(rec, seen, existing);
        if (!result.ok) {
          if (errors.length < IMPORT_ERROR_CAP) {
            errors.push({
              row: rec.rowNum,
              stationCode: rec.stationCode,
              message: result.message,
            });
          }
          continue;
        }
        // Reserve the code now so later rows in the file can't collide with it.
        seen.add(result.row.stationCode);
        existing.add(result.row.stationCode);
        const provinceId = await this.provinceResolver.resolveProvinceId(
          result.row.latitude,
          result.row.longitude,
        );
        ready.push({ row: result.row, provinceId });
      }

      await this.dataSource.transaction(async (manager) => {
        for (const { row, provinceId } of ready) {
          const id = await this.insertStation(manager, row, provinceId);
          if (row.tiers.length > 0) thresholdStationIds.push(id);
          success++;
        }
      });

      processed += batch.length;
      await job.updateProgress(Math.round((processed / total) * 100));
    }

    // Seeding thresholds feeds risk inputs → nudge the Risk Engine per station
    // (fire-and-forget; a bus failure must not fail the completed import).
    for (const id of thresholdStationIds) this.emitThresholdChanged(id);

    return {
      total,
      success,
      failed: total - success,
      errors,
      truncatedErrors: total - success > errors.length,
    };
  }

  // --------------------------------------------------------------------------
  // Internals.
  // --------------------------------------------------------------------------

  private async loadExistingCodes(): Promise<Set<string>> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('s.station_code', 'code')
      .from(Station, 's')
      .getRawMany<{ code: string }>();
    return new Set(rows.map((r) => r.code));
  }

  private validate(
    rec: ImportRecord,
    seen: Set<string>,
    existing: Set<string>,
  ): { ok: true; row: ValidRow } | { ok: false; message: string } {
    const code = rec.stationCode;
    if (!code) return { ok: false, message: 'Thiếu mã trạm (station_code).' };
    if (code.length > 50) return { ok: false, message: 'Mã trạm vượt quá 50 ký tự.' };
    if (!STATION_CODE_RE.test(code)) {
      return { ok: false, message: 'Mã trạm chỉ gồm chữ, số, "-" và "_".' };
    }
    if (seen.has(code)) return { ok: false, message: 'Mã trạm trùng trong file.' };
    if (existing.has(code)) {
      return { ok: false, message: 'Mã trạm đã tồn tại trong hệ thống.' };
    }

    if (!rec.name) return { ok: false, message: 'Thiếu tên trạm (name).' };
    if (rec.name.length > 255) return { ok: false, message: 'Tên trạm vượt quá 255 ký tự.' };

    const latitude = this.num(rec.latitude);
    if (latitude === null || latitude < 6 || latitude > 24) {
      return { ok: false, message: 'Vĩ độ không hợp lệ (cần trong khoảng 6–24).' };
    }
    const longitude = this.num(rec.longitude);
    if (longitude === null || longitude < 102 || longitude > 118) {
      return { ok: false, message: 'Kinh độ không hợp lệ (cần trong khoảng 102–118).' };
    }

    let elevation: number | null = null;
    if (rec.elevation) {
      const e = this.num(rec.elevation);
      if (e === null || e < -500 || e > 9000) {
        return { ok: false, message: 'Độ cao không hợp lệ (cần trong khoảng -500–9000 m).' };
      }
      elevation = e;
    }

    const tiers: ValidRow['tiers'] = [];
    const tierInputs: [string, AlertLevel][] = [
      [rec.th1, AlertLevel.WATCH],
      [rec.th2, AlertLevel.WARNING],
      [rec.th3, AlertLevel.DANGER],
    ];
    for (const [raw, alertLevel] of tierInputs) {
      if (!raw) continue;
      const v = this.num(raw);
      if (v === null || Math.abs(v) >= 100000) {
        return { ok: false, message: `Ngưỡng cấp ${alertLevel} không hợp lệ.` };
      }
      tiers.push({ alertLevel, thresholdValue: Math.round(v * 100) / 100 });
    }

    return {
      ok: true,
      row: { stationCode: code, name: rec.name, latitude, longitude, elevation, tiers },
    };
  }

  /** Insert one station + geom + thresholds on the batch's transaction manager. */
  private async insertStation(
    manager: EntityManager,
    row: ValidRow,
    provinceId: number | null,
  ): Promise<number> {
    const result = await manager.insert(Station, {
      stationCode: row.stationCode,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      elevation: row.elevation,
      isDeleted: false,
    });
    const id = result.identifiers[0].id as number;

    // geom (SRID 4326); province_id was already resolved in the pre-pass (spatial
    // fast-path, else geocode + auto-create). geom is never written via entity save.
    await manager.query(
      `UPDATE stations
          SET geom = ST_SetSRID(ST_MakePoint($1, $2), 4326),
              province_id = $3
        WHERE id = $4`,
      [row.longitude, row.latitude, provinceId, id],
    );

    if (row.tiers.length > 0) {
      await manager.insert(
        FloodThreshold,
        row.tiers.map((t) => ({
          stationId: id,
          alertLevel: t.alertLevel,
          thresholdValue: t.thresholdValue,
          label: null,
        })),
      );
    }
    return id;
  }

  /** Parse a decimal string; null if blank/non-finite. */
  private num(raw: string): number | null {
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  private emitThresholdChanged(stationId: number): void {
    void this.eventBus
      .publish(EVENT_CHANNELS.THRESHOLD_CHANGED, { stationId })
      .catch((err) =>
        this.logger.error(
          `failed to publish threshold-changed for station=${stationId}: ${(err as Error).message}`,
        ),
      );
  }
}
