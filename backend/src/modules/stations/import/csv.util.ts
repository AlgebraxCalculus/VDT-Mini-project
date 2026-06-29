/**
 * Minimal RFC-4180-ish CSV parser — enough for station import files (no external
 * dependency). Handles quoted fields, escaped quotes (`""`), embedded commas /
 * newlines inside quotes, a leading UTF-8 BOM, and both CRLF and LF line endings.
 */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the trailing field/row when the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) endRow();

  // Drop fully-empty rows (e.g. blank trailing lines) so they don't count as data.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Normalize a header cell to a lookup key: lowercased, trimmed, spaces/dashes → `_`. */
export function normalizeHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}
