// engine/parseKpiInputExcelToJsonRows.ts
//
// Parse KPI Excel (.xlsx) into KpiJsonRowIn[] for bulk inspection.

import ExcelJS from 'exceljs';
import type { KpiJsonRowIn } from './bulkTypes';

const EXPECTED_HEADERS = [
  'company',
  'team_role',
  'task_type',
  'task_name',
  'dead_line',
  'strategic_benefit',
  'output_metric',
  'quality_metric',
  'improvement_metric',
  'mode'
] as const;

type CanonicalHeader = (typeof EXPECTED_HEADERS)[number];

function normalizeHeader(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
}

function buildHeaderIndexMap(
  headerRow: ExcelJS.Row
): Record<CanonicalHeader, number> {
  const map: Partial<Record<CanonicalHeader, number>> = {};

  headerRow.eachCell((cell, colNumber) => {
    const norm = normalizeHeader(cell.value);
    for (const expected of EXPECTED_HEADERS) {
      const target = expected.toLowerCase().replace(/_/g, '');
      if (norm === target) {
        map[expected] = colNumber;
        break;
      }
    }
  });

  // Hard fail if any required header is missing.
  const missing = EXPECTED_HEADERS.filter((h) => !map[h]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns in Excel header: ${missing.join(', ')}. ` +
        `Expected headers: ${EXPECTED_HEADERS.join(', ')}`
    );
  }

  return map as Record<CanonicalHeader, number>;
}

function readCellAsString(row: ExcelJS.Row, col: number | undefined): string {
  if (!col) return '';
  const cell = row.getCell(col);
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) {
    // You already enforce accepted deadline formats elsewhere (validateDeadline.ts).
    // Here we just produce ISO yyyy-mm-dd for dates.
    const year = v.getFullYear();
    const month = String(v.getMonth() + 1).padStart(2, '0');
    const day = String(v.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(v).trim();
}

function isRowCompletelyEmpty(
  row: ExcelJS.Row,
  headerMap: Record<CanonicalHeader, number>
): boolean {
  return EXPECTED_HEADERS.every((header) => {
    const col = headerMap[header];
    const raw = row.getCell(col).value;
    return raw == null || String(raw).trim() === '';
  });
}

/**
 * Parse the KPI input Excel buffer into KpiJsonRowIn[].
 * - Uses sheet "KPI_Input" if present; otherwise the first worksheet.
 * - Expects header row at row 1.
 * - Skips completely empty data rows.
 * - Assigns row_id starting from 1 in data terms (not Excel row index).
 */
export async function parseKpiInputExcelToJsonRows(
  buffer: Buffer
): Promise<KpiJsonRowIn[]> {
  const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

  const worksheet =
    workbook.getWorksheet('KPI_Input') ?? workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('No worksheet found in KPI Excel file.');
  }

  const headerRow = worksheet.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    throw new Error('Header row (row 1) is empty or missing.');
  }

  const headerMap = buildHeaderIndexMap(headerRow);

  const rows: KpiJsonRowIn[] = [];
  let logicalRowId = 1;

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    if (!row || isRowCompletelyEmpty(row, headerMap)) continue;

    const company = readCellAsString(row, headerMap.company);
    const team_role = readCellAsString(row, headerMap.team_role);
    const task_type = readCellAsString(row, headerMap.task_type);
    const task_name = readCellAsString(row, headerMap.task_name);
    const dead_line = readCellAsString(row, headerMap.dead_line);
    const strategic_benefit = readCellAsString(
      row,
      headerMap.strategic_benefit
    );
    const output_metric = readCellAsString(row, headerMap.output_metric);
    const quality_metric = readCellAsString(row, headerMap.quality_metric);
    const improvement_metric = readCellAsString(
      row,
      headerMap.improvement_metric
    );
    const mode = readCellAsString(row, headerMap.mode);

    const jsonRow: KpiJsonRowIn = {
      row_id: logicalRowId,
      company: company || null,
      team_role: team_role || null,
      task_type: task_type || null,
      task_name: task_name || null,
      dead_line: dead_line || null,
      strategic_benefit: strategic_benefit || null,
      output_metric: output_metric || null,
      quality_metric: quality_metric || null,
      improvement_metric: improvement_metric || null,
      mode: mode || null
    };

    rows.push(jsonRow);
    logicalRowId += 1;
  }

  return rows;
}