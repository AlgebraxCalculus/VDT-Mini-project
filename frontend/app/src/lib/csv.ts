// Client-side CSV pre-flight for the import view. The nghiệp vụ doc calls for
// "validate định dạng ngay tại client trước khi gọi API" — this parses the file
// and flags format errors so the user sees them before uploading. The BACKEND
// re-validates authoritatively (and owns DB-uniqueness/province checks); this is
// advisory UX only. Header aliases + ranges mirror StationImportService/Processor.

export interface PreviewRow {
  rowNum: number;
  stationCode: string;
  name: string;
  latitude: string;
  longitude: string;
  valid: boolean;
  message: string;
}

export interface PreviewResult {
  headerError: string | null;
  rows: PreviewRow[];
  validCount: number;
  invalidCount: number;
}

const HEADER_ALIASES: Record<string, string[]> = {
  stationCode: ['station_code', 'stationcode', 'code', 'ma_tram'],
  name: ['name', 'ten', 'ten_tram'],
  latitude: ['latitude', 'lat', 'vi_do'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'kinh_do'],
  elevation: ['elevation', 'elev', 'do_cao'],
};

const REQUIRED = ['stationCode', 'name', 'latitude', 'longitude'];
const STATION_CODE_RE = /^[A-Za-z0-9_-]+$/;

/** RFC-4180-ish parser (matches the backend csv.util): quotes, "" escapes, CRLF/LF, BOM. */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const normalizeHeader = (cell: string) =>
  cell.trim().toLowerCase().replace(/[\s-]+/g, '_');

const num = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};

/** Parse + format-validate CSV text for the preview table. */
export function previewCsv(text: string): PreviewResult {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return {
      headerError: 'File rỗng hoặc chỉ có dòng tiêu đề — cần ít nhất một dòng dữ liệu.',
      rows: [],
      validCount: 0,
      invalidCount: 0,
    };
  }

  const headers = rows[0].map(normalizeHeader);
  const col: Record<string, number> = {};
  for (const key of Object.keys(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => HEADER_ALIASES[key].includes(h));
    if (idx !== -1) col[key] = idx;
  }
  const missing = REQUIRED.filter((k) => col[k] === undefined);
  if (missing.length > 0) {
    return {
      headerError: `Thiếu cột bắt buộc: ${missing.join(', ')} (cần station_code, name, latitude, longitude).`,
      rows: [],
      validCount: 0,
      invalidCount: 0,
    };
  }

  const at = (row: string[], key: string) => (col[key] === undefined ? '' : (row[col[key]] ?? '').trim());
  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  let validCount = 0;

  rows.slice(1).forEach((row, i) => {
    const stationCode = at(row, 'stationCode');
    const name = at(row, 'name');
    const latitude = at(row, 'latitude');
    const longitude = at(row, 'longitude');
    const lat = num(latitude);
    const lng = num(longitude);

    let message = '';
    if (!stationCode) message = 'Thiếu mã trạm';
    else if (!STATION_CODE_RE.test(stationCode)) message = 'Mã trạm không hợp lệ';
    else if (seen.has(stationCode)) message = 'Mã trạm trùng trong file';
    else if (!name) message = 'Thiếu tên trạm';
    else if (lat === null || lat < 6 || lat > 24) message = 'Vĩ độ ngoài khoảng 6–24';
    else if (lng === null || lng < 102 || lng > 118) message = 'Kinh độ ngoài khoảng 102–118';

    const valid = message === '';
    if (stationCode) seen.add(stationCode);
    if (valid) {
      validCount++;
      message = 'Hợp lệ';
    }
    out.push({ rowNum: i + 2, stationCode, name, latitude, longitude, valid, message });
  });

  return { headerError: null, rows: out, validCount, invalidCount: out.length - validCount };
}

/** A ready-to-download CSV template with the documented columns + one example row. */
export const SAMPLE_CSV =
  'station_code,name,latitude,longitude,elevation,threshold_l1,threshold_l2,threshold_l3\n' +
  'VTS-QT-001,Trạm Đông Hà,16.8163,107.1003,8.5,2.0,3.5,5.0\n';
