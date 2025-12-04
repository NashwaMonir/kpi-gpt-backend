// engine/parseKpiInputExcel.ts
import * as XLSX from 'xlsx';
import type { ParsedRow, ParsedExcelInspectionResult } from './bulkTypes';

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function normalizeHeader(header: string): string {
  const h = header.trim().toLowerCase();

  if (h === 'company' || h === 'organisation' || h === 'organization') return 'company';

  if (h === 'team_role' || h === 'role' || h === 'team role') return 'team_role';

  if (h === 'task_type' || h === 'type' || h === 'task type') return 'task_type';

  if (h === 'task_name' || h === 'task' || h === 'name') return 'task_name';

  if (h === 'deadline' || h === 'dead_line' || h === 'due date') return 'dead_line';

  if (h === 'strategic_benefit' || h === 'benefit' || h === 'strategic benefit')
    return 'strategic_benefit';

  if (h === 'output_metric' || h === 'output metric') return 'output_metric';

  if (h === 'quality_metric' || h === 'quality metric') return 'quality_metric';

  if (h === 'improvement_metric' || h === 'improvement metric') return 'improvement_metric';

  if (h === 'mode' || h === 'objective_mode') return 'mode';

  return h;
}

function detectMode(raw: string | null): ParsedRow['mode'] {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'simple') return 'simple';
  if (v === 'complex') return 'complex';
  return 'both';
}

export function parseKpiInputExcel(fileBuffer: Buffer): ParsedExcelInspectionResult {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: ''
  } as any);

  const parsedRows: ParsedRow[] = [];

  let has_company_column = false;

  for (let index = 0; index < jsonRows.length; index++) {
    const row = jsonRows[index];
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      const nk = normalizeHeader(key);
      normalized[nk] = value;
    }

    if ('company' in normalized) {
      has_company_column = true;
    }

    const modeStr = toStringOrNull(normalized['mode']);

    const team_role = toStringOrNull(normalized['team_role']);
    const task_type = toStringOrNull(normalized['task_type']);
    const task_name = toStringOrNull(normalized['task_name']);
    const dead_line = toStringOrNull(normalized['dead_line']);

    const isValid = !!team_role && !!task_type && !!task_name && !!dead_line;

    const parsedRow: ParsedRow = {
      row_id: index + 1,
      company: toStringOrNull(normalized['company']),
      team_role,
      task_type,
      task_name,
      dead_line,
      strategic_benefit: toStringOrNull(normalized['strategic_benefit']),
      output_metric: toStringOrNull(normalized['output_metric']),
      quality_metric: toStringOrNull(normalized['quality_metric']),
      improvement_metric: toStringOrNull(normalized['improvement_metric']),
      mode: detectMode(modeStr),
      isValid,
      invalidReason: isValid ? undefined : 'Missing mandatory fields in Excel row'
    };

    parsedRows.push(parsedRow);
  }

  const row_count = parsedRows.length;
  const invalid_row_count = parsedRows.filter((r) => !r.isValid).length;

  const companyValues = parsedRows
    .map((r) => (r.company ? r.company.trim() : ''))
    .filter((v) => v.length > 0);

  const unique_companies = Array.from(new Set(companyValues));
  const missing_company_count = parsedRows.filter((r) => !r.company).length;

  let company_case: ParsedExcelInspectionResult['company_case'] = 'no_company_data';

  if (has_company_column) {
    if (unique_companies.length === 0) {
      company_case = 'no_company_data';
    } else if (unique_companies.length === 1) {
      company_case = 'single_company_column';
    } else {
      company_case = 'multi_company_column';
    }
  } else {
    company_case = 'no_company_data';
  }

  const benefit_company_signals: string[] = [];
  const has_invalid_rows = invalid_row_count > 0;

  const needs_company_decision =
    company_case === 'multi_company_column' || (!has_company_column && unique_companies.length === 0);

  const ui_prompt =
    company_case === 'single_company_column'
      ? `Detected ${row_count} row(s). All rows use company "${unique_companies[0]}". Choose how to proceed.`
      : company_case === 'multi_company_column'
      ? `Detected ${row_count} row(s) with multiple companies (${unique_companies.join(
          ', '
        )}). Choose how to handle company differences.`
      : `Detected ${row_count} row(s). No consistent company column. Choose generic mode or provide a company.`;

  const options: ParsedExcelInspectionResult['options'] = [];

  if (company_case === 'single_company_column') {
    options.push(
      { code: 'use_sheet_company', label: 'Use the company from the sheet for all rows.' },
      { code: 'generic_mode', label: 'Ignore company and generate generic objectives.' }
    );
  } else if (company_case === 'multi_company_column') {
    options.push(
      { code: 'keep_each_company', label: 'Keep each row’s company as-is.' },
      {
        code: 'overwrite_with_selected',
        label: 'Overwrite all rows with a single company I will provide.'
      },
      { code: 'generic_mode', label: 'Ignore company and generate generic objectives.' }
    );
  } else {
    options.push(
      { code: 'generic_mode', label: 'Generate objectives in generic mode (no company).' },
      {
        code: 'use_selected_company',
        label: 'Apply a single company I will provide to all rows.'
      }
    );
  }

  const result: ParsedExcelInspectionResult = {
    rows: parsedRows,
    row_count,
    invalid_row_count,
    has_company_column,
    unique_companies,
    missing_company_count,
    benefit_company_signals,
    company_case,
    needs_company_decision,
    has_invalid_rows,
    ui_prompt,
    options
  };

  return result;
}