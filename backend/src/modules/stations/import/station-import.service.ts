import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { parseCsv, normalizeHeader } from './csv.util';
import {
  IMPORT_MAX_ROWS,
  STATION_IMPORT_JOB,
  STATION_IMPORT_QUEUE,
} from './station-import.constants';

/** One raw (unvalidated) station row carried on the queue — values stay strings;
 *  the worker validates + coerces them. `rowNum` is the 1-based CSV line number. */
export interface ImportRecord {
  rowNum: number;
  stationCode: string;
  name: string;
  latitude: string;
  longitude: string;
  elevation: string;
  th1: string;
  th2: string;
  th3: string;
}

export interface StationImportJobData {
  records: ImportRecord[];
  triggeredBy: number | null;
}

export interface ImportRowError {
  row: number;
  stationCode: string;
  message: string;
}

/** Final report produced by the worker (API 19 output). */
export interface ImportReport {
  total: number;
  success: number;
  failed: number;
  errors: ImportRowError[];
  truncatedErrors: boolean; // true when more errors occurred than the report carries
}

export interface ImportStatus {
  jobId: string;
  state: string;
  progress: number;
  report: ImportReport | null;
  failedReason: string | null;
}

/** Minimal shape of a memory-storage multer file (avoids needing @types/multer). */
export interface UploadedCsvFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Canonical column → accepted header aliases (all normalized via normalizeHeader).
 * `name`/`station_code`/`latitude`/`longitude` are required; the rest optional.
 */
const HEADER_ALIASES: Record<keyof Omit<ImportRecord, 'rowNum'>, string[]> = {
  stationCode: ['station_code', 'stationcode', 'code', 'ma_tram'],
  name: ['name', 'ten', 'ten_tram'],
  latitude: ['latitude', 'lat', 'vi_do'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'kinh_do'],
  elevation: ['elevation', 'elev', 'do_cao'],
  th1: ['threshold_l1', 'threshold_level1', 'th1', 'muc_1', 'nguong_1'],
  th2: ['threshold_l2', 'threshold_level2', 'th2', 'muc_2', 'nguong_2'],
  th3: ['threshold_l3', 'threshold_level3', 'th3', 'muc_3', 'nguong_3'],
};

const REQUIRED: (keyof Omit<ImportRecord, 'rowNum'>)[] = [
  'stationCode',
  'name',
  'latitude',
  'longitude',
];

/**
 * Group C — async station import (APIs 18–19). Parses + shape-validates the
 * uploaded CSV synchronously (so a malformed file fails fast with 400), then
 * enqueues a BullMQ job; the heavy per-row validation + batched insert runs in
 * {@link StationImportProcessor}. Mirrors the WeatherService enqueue/status shape.
 */
@Injectable()
export class StationImportService {
  constructor(
    @InjectQueue(STATION_IMPORT_QUEUE)
    private readonly queue: Queue<StationImportJobData>,
  ) {}

  /** API 18 — accept the upload, parse to records, enqueue → { jobId }. */
  async enqueueImport(
    file: UploadedCsvFile | undefined,
    userId: number,
  ): Promise<{ jobId: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Thiếu file tải lên (trường "file").');
    }

    const records = this.parseToRecords(file.buffer.toString('utf8'));

    const jobId = randomUUID();
    await this.queue.add(
      STATION_IMPORT_JOB,
      { records, triggeredBy: userId },
      { jobId },
    );
    return { jobId };
  }

  /** API 19 — job state + progress + the final report (when complete). */
  async getStatus(jobId: string): Promise<ImportStatus> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    const state = await job.getState();
    const rawProgress = job.progress;
    const progress = typeof rawProgress === 'number' ? rawProgress : 0;
    const report = (job.returnvalue as ImportReport | undefined) ?? null;
    return {
      jobId,
      state,
      progress,
      report,
      failedReason: job.failedReason ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // CSV → records (header mapping + file-shape guards).
  // --------------------------------------------------------------------------

  private parseToRecords(text: string): ImportRecord[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      throw new BadRequestException(
        'File rỗng hoặc chỉ có dòng tiêu đề — cần ít nhất một dòng dữ liệu.',
      );
    }

    const headers = rows[0].map(normalizeHeader);
    const colIndex = this.resolveColumns(headers);

    const dataRows = rows.slice(1);
    if (dataRows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Vượt quá giới hạn ${IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng/lần (file có ${dataRows.length}).`,
      );
    }

    const at = (row: string[], key: keyof Omit<ImportRecord, 'rowNum'>): string => {
      const idx = colIndex[key];
      return idx === undefined ? '' : (row[idx] ?? '').trim();
    };

    return dataRows.map((row, i) => ({
      rowNum: i + 2, // +1 for the header, +1 for 1-based line numbering
      stationCode: at(row, 'stationCode'),
      name: at(row, 'name'),
      latitude: at(row, 'latitude'),
      longitude: at(row, 'longitude'),
      elevation: at(row, 'elevation'),
      th1: at(row, 'th1'),
      th2: at(row, 'th2'),
      th3: at(row, 'th3'),
    }));
  }

  /** Map canonical columns to their position in the header row; 400 if any required missing. */
  private resolveColumns(
    headers: string[],
  ): Partial<Record<keyof Omit<ImportRecord, 'rowNum'>, number>> {
    const colIndex: Partial<Record<keyof Omit<ImportRecord, 'rowNum'>, number>> = {};
    for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
      const idx = headers.findIndex((h) => HEADER_ALIASES[key].includes(h));
      if (idx !== -1) colIndex[key] = idx;
    }
    const missing = REQUIRED.filter((k) => colIndex[k] === undefined);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Thiếu cột bắt buộc: ${missing.join(', ')}. ` +
          'Cột yêu cầu: station_code, name, latitude, longitude.',
      );
    }
    return colIndex;
  }
}
