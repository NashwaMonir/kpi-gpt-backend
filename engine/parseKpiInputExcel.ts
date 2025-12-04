// engine/parseKpiInputExcel.ts
// Excel → ParsedRow[] for KPI bulk flows (v10.7.5-compatible)

import * as XLSX from 'xlsx';
import type { ParsedRow } from './bulkTypes';

// Normalize header names for robust matching
function normalizeHeader(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function parseKpiInputExcel(buffer: Buffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName =
    workbook.SheetNames.find(n => n.toLowerCase() === 'kpi_input') ??
    workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const jsonRows = XLSX.utils.sheet_to_json(sheet, {
    defval: ''
  } as any) as Record<string, unknown>[];

  const parsed: ParsedRow[] = jsonRows.map((row, index) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = value;
    }

    const toStringOrNull = (val: unknown): string | null => {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      return s === '' ? null : s;
    };

    const modeStr = toStringOrNull(normalized['mode']);

    // Basic Excel-level validity: mandatory fields present?
    const isValid =
      !!toStringOrNull(normalized['team_role']) &&
      !!toStringOrNull(normalized['task_type']) &&
      !!toStringOrNull(normalized['task_name']) &&
      !!toStringOrNull(normalized['dead_line']);

    return {
      row_id: index + 1,
      company: toStringOrNull(normalized['company']),
      team_role: toStringOrNull(normalized['team_role']),
      task_type: toStringOrNull(normalized['task_type']),
      task_name: toStringOrNull(normalized['task_name']),
      dead_line: toStringOrNull(normalized['dead_line']),
      strategic_benefit: toStringOrNull(normalized['strategic_benefit']),
      output_metric: toStringOrNull(normalized['output_metric']),
      quality_metric: toStringOrNull(normalized['quality_metric']),
      improvement_metric: toStringOrNull(normalized['improvement_metric']),
      mode: modeStr as ParsedRow['mode'],
      isValid,
      invalidReason: isValid ? undefined : 'Missing mandatory fields in Excel row'
    };
  });

  return parsed;
}