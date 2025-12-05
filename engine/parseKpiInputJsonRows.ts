// engine/parseKpiInputJsonRows.ts

import {
  KpiJsonRowIn,
  ParsedRow,
  BulkInspectSummary,
  RowsTokenPayload,
  encodeRowsToken
} from './bulkTypes';

const MAX_BULK_ROWS = 50;

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function normalizeMode(value: unknown): ParsedRow['mode'] {
  const s = (toStringOrNull(value) || '').toLowerCase();
  if (s === 'simple') return 'simple';
  if (s === 'complex') return 'complex';
  return 'both';
}

export interface JsonInspectResult {
  summary: BulkInspectSummary;
  parsedRows: ParsedRow[];
}

/**
 * Inspect JSON KPI rows for bulk processing.
 * This is the JSON counterpart of parseKpiInputExcel.
 */
export function inspectJsonRowsForBulk(rows: KpiJsonRowIn[]): JsonInspectResult {
  if (!Array.isArray(rows)) {
    throw new Error('Invalid input: rows must be an array.');
  }

  if (rows.length === 0) {
    throw new Error('No rows provided.');
  }

  if (rows.length > MAX_BULK_ROWS) {
    throw new Error(
      `Bulk row limit exceeded. Max ${MAX_BULK_ROWS} rows allowed, found ${rows.length}.`
    );
  }

  const parsedRows: ParsedRow[] = [];
  let invalid_row_count = 0;

  for (let index = 0; index < rows.length; index++) {
    const src = rows[index] || {};

    const company = toStringOrNull(src.company);
    const team_role = toStringOrNull(src.team_role);
    const task_type = toStringOrNull(src.task_type);
    const task_name = toStringOrNull(src.task_name);
    const dead_line = toStringOrNull(src.dead_line);
    const strategic_benefit = toStringOrNull(src.strategic_benefit);
    const output_metric = toStringOrNull(src.output_metric);
    const quality_metric = toStringOrNull(src.quality_metric);
    const improvement_metric = toStringOrNull(src.improvement_metric);
    const mode = normalizeMode(src.mode);

    const hasMandatory =
      !!team_role && !!task_type && !!task_name && !!dead_line;

    const parsed: ParsedRow = {
      row_id: index + 1,
      company,
      team_role,
      task_type,
      task_name,
      dead_line,
      strategic_benefit,
      output_metric,
      quality_metric,
      improvement_metric,
      mode,
      isValid: hasMandatory,
      invalidReason: hasMandatory ? undefined : 'Missing mandatory fields in JSON row'
    };

    if (!hasMandatory) {
      invalid_row_count += 1;
    }

    parsedRows.push(parsed);
  }

  const row_count = parsedRows.length;

  const nonEmptyCompanies = parsedRows
    .map((r) => r.company)
    .filter((c): c is string => !!c && c.trim().length > 0)
    .map((c) => c.trim());

  const has_company_column = nonEmptyCompanies.length > 0;
  const unique_companies = Array.from(new Set(nonEmptyCompanies));

  const missing_company_count = has_company_column
    ? parsedRows.filter((r) => !r.company || r.company.trim() === '').length
    : 0;

  const benefit_company_signals: string[] = []; // optional; can be extended later

  let company_case: BulkInspectSummary['company_case'];

  if (!has_company_column) {
    company_case = 'no_company_data';
  } else if (unique_companies.length === 1) {
    company_case = 'single_company_column';
  } else {
    company_case = 'multi_company_column';
  }

  const needs_company_decision =
    company_case !== 'no_company_data' &&
    (unique_companies.length > 1 || missing_company_count > 0);

  const has_invalid_rows = invalid_row_count > 0;

  const state: BulkInspectSummary['state'] = 'INSPECTED';

  let ui_prompt: string;
  const companyLabel =
    unique_companies.length === 1 ? `"${unique_companies[0]}"` : 'multiple companies';

  if (company_case === 'single_company_column') {
    ui_prompt = `Detected ${row_count} row(s). All rows use company ${companyLabel}. Choose how to proceed.`;
  } else if (company_case === 'multi_company_column') {
    ui_prompt = `Detected ${row_count} row(s) with multiple companies in the data. Choose how to proceed.`;
  } else {
    ui_prompt = `Detected ${row_count} row(s). No company column detected. Choose how to proceed.`;
  }

  const options = [];

  if (company_case === 'single_company_column') {
    options.push(
      {
        code: 'use_sheet_company',
        label: 'Use the company from the data for all rows.'
      },
      {
        code: 'generic_mode',
        label: 'Ignore company and generate generic objectives.'
      }
    );
  } else {
    options.push(
      {
        code: 'generic_mode',
        label: 'Ignore company and generate generic objectives.'
      }
    );
  }

  const tokenPayload: RowsTokenPayload = {
    parsedRows,
    summaryMeta: {
      row_count,
      invalid_row_count,
      has_company_column,
      unique_companies,
      missing_company_count,
      benefit_company_signals,
      company_case,
      needs_company_decision,
      has_invalid_rows
    }
  };

  const rows_token = encodeRowsToken(tokenPayload);

  const summary: BulkInspectSummary = {
    rows_token,
    row_count,
    invalid_row_count,
    has_company_column,
    unique_companies,
    missing_company_count,
    benefit_company_signals,
    company_case,
    needs_company_decision,
    has_invalid_rows,
    state,
    ui_prompt,
    options
  };

  return { summary, parsedRows };
}