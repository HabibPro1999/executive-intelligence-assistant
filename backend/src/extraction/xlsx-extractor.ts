import * as XLSX from 'xlsx';
import { ExtractionResult, ExtractedSegment } from '../common/types';

// How many data rows to group into a single readable segment, so we never
// embed one tiny row at a time (PRD §17.4).
const ROWS_PER_SEGMENT = 15;

// Convert each sheet into readable, row-grouped text with sheet + row range
// metadata preserved for citations.
export function extractXlsx(buffer: Buffer): ExtractionResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const segments: ExtractedSegment[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const grid: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });
    if (grid.length === 0) continue;

    const header = (grid[0] || []).map((h) => String(h).trim());
    const dataRows = grid.slice(1);
    if (dataRows.length === 0) {
      // Header-only or single-block sheet: keep the raw text.
      const content = grid.map((r) => r.join(' | ')).join('\n').trim();
      if (content) {
        segments.push({
          content: `Sheet: ${sheetName}\n${content}`,
          page_number: null,
          sheet_name: sheetName,
          section_title: null,
        });
      }
      continue;
    }

    for (let start = 0; start < dataRows.length; start += ROWS_PER_SEGMENT) {
      const batch = dataRows.slice(start, start + ROWS_PER_SEGMENT);
      // +2: row 1 is the header, data rows are 1-indexed from there.
      const firstRow = start + 2;
      const lastRow = start + batch.length + 1;

      const lines = batch.map((row, i) => {
        const cells = row
          .map((cell, ci) => {
            const key = header[ci] || `Column ${ci + 1}`;
            const val = String(cell).trim();
            return val ? `${key}: ${val}` : null;
          })
          .filter(Boolean);
        return `Row ${firstRow + i} — ${cells.join('; ')}`;
      });

      const content =
        `Sheet: ${sheetName}\nRows: ${firstRow}-${lastRow}\n` + lines.join('\n');

      segments.push({
        content: content.trim(),
        page_number: null,
        sheet_name: sheetName,
        section_title: null,
        metadata: { row_start: firstRow, row_end: lastRow },
      });
    }
  }

  return { segments, sheet_count: wb.SheetNames.length };
}
