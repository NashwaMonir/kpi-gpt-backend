// api/bulkInspectJson.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parse } from 'csv-parse/sync';
import {
  KpiJsonRowIn,
  ParsedRow,
  BulkInspectJsonRequest,
  BulkInspectJsonResponse,
  BulkInspectOption,
  CompanyCase,
  RowsTokenPayload,
  encodeRowsToken
} from '../engine/bulkTypes';
import { normalizeDeadline } from '../engine/normalizeFields';

function toStringSafe(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

/**
 * Robust CSV → KpiJsonRowIn[]
 *
 * Expects a header row. Primary columns:
 * - task_name
 * - task_type
 * - team_role
 * - dead_line / deadline (both supported, mapped to dead_line)
 * - strategic_benefit
 * - output_metric
 * - quality_metric
 * - improvement_metric
 * - company
 */
/**
 * IMPORTANT (v10.8): bulkInspectJson only performs *minimum completeness* checks.
 * It does NOT run full domain validation (deadline year/format, dangerous text,
 * enum allow-lists, metrics auto-suggest). Those are enforced in bulkFinalizeExport
 * using engine-aligned rules.
 */
export function parseCsvToKpiJsonRows(csvText: string): KpiJsonRowIn[] {
  if (!csvText || csvText.trim().length === 0) {
    return [];
  }

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string | null | undefined>[];

  const rows: KpiJsonRowIn[] = [];

  const get = (
    row: Record<string, string | null | undefined>,
    ...keys: string[]
  ): string => {
    for (const key of keys) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim().length > 0) {
        return String(v).trim();
      }
    }
    return '';
  };

  records.forEach((row, index) => {
    const r: Record<string, string | null | undefined> = row;

    const rawDeadline = get(r, 'dead_line', 'deadline');
    const nd = normalizeDeadline(rawDeadline);
    const normalizedDeadline = nd.isValid && nd.normalized ? nd.normalized : rawDeadline;

    const kpiRow: KpiJsonRowIn = {
      row_id: index + 1,
      task_name: get(r, 'task_name', 'task name'),
      task_type: get(r, 'task_type', 'task type'),
      team_role: get(r, 'team_role', 'team role'),
      // Accept both "dead_line" and "deadline" as header
      dead_line: normalizedDeadline,
      strategic_benefit: get(r, 'strategic_benefit', 'strategic benefit'),
      output_metric: get(r, 'output_metric', 'output metric'),
      quality_metric: get(r, 'quality_metric', 'quality metric'),
      improvement_metric: get(r, 'improvement_metric', 'improvement metric'),
      company: get(r, 'company')
    };

    const isCompletelyEmpty =
      !kpiRow.company &&
      !kpiRow.team_role &&
      !kpiRow.task_type &&
      !kpiRow.task_name &&
      !kpiRow.dead_line &&
      !kpiRow.strategic_benefit &&
      !kpiRow.output_metric &&
      !kpiRow.quality_metric &&
      !kpiRow.improvement_metric;

    if (!isCompletelyEmpty) {
      rows.push(kpiRow);
    }
  });

  return rows;
}

export function normalizeAndValidateRows(
  rows: KpiJsonRowIn[]
): {
  parsedRows: ParsedRow[];
  row_count: number;
  invalid_row_count: number;
  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;
  benefit_company_signals: string[];
  company_case: CompanyCase;
  needs_company_decision: boolean;
  has_invalid_rows: boolean;
} {
  const parsedRows: ParsedRow[] = [];
  const companySet = new Set<string>();
  let has_company_column = false;
  let missing_company_count = 0;
  let invalid_count = 0;

  rows.forEach((raw, index) => {
    const team_role = toStringSafe(raw.team_role);
    const task_type = toStringSafe(raw.task_type);
    const task_name = toStringSafe(raw.task_name);
    const dead_line_raw = toStringSafe(raw.dead_line);
    const nd = normalizeDeadline(dead_line_raw);
    const dead_line = nd.isValid && nd.normalized ? nd.normalized : dead_line_raw;

    const company = toStringSafe(raw.company);
    const strategic_benefit = toStringSafe(raw.strategic_benefit);
    const output_metric = toStringSafe(raw.output_metric);
    const quality_metric = toStringSafe(raw.quality_metric);
    const improvement_metric = toStringSafe(raw.improvement_metric);

    if (company.length > 0) {
      has_company_column = true;
      companySet.add(company);
    } else {
      missing_company_count += 1;
    }

    // "isValid" here means "minimally complete" (NOT engine-valid)
    const missingFields: string[] = [];
    if (!task_name) missingFields.push('Task Name');
    if (!task_type) missingFields.push('Task Type');
    if (!team_role) missingFields.push('Team Role');
    if (!dead_line) missingFields.push('Deadline');
    if (!strategic_benefit) missingFields.push('Strategic Benefit');

    const isValid = missingFields.length === 0;

    if (!isValid) {
      invalid_count += 1;
    }

    const parsed: ParsedRow = {
      row_id: raw.row_id ?? index + 1,
      company,
      team_role,
      task_type,
      task_name,
      dead_line,
      strategic_benefit,
      output_metric,
      quality_metric,
      improvement_metric,
      isValid,
      invalidReason: isValid
        ? undefined
        : `Missing required field(s): ${missingFields.join(', ')}`
    };

    const isCompletelyEmpty =
      !company &&
      !team_role &&
      !task_type &&
      !task_name &&
      !dead_line &&
      !strategic_benefit &&
      !output_metric &&
      !quality_metric &&
      !improvement_metric;

    if (!isCompletelyEmpty) {
      parsedRows.push(parsed);
    }
  });

  const row_count = parsedRows.length;
  const invalid_row_count = invalid_count;
  const unique_companies = Array.from(companySet);
  const has_invalid_rows = invalid_row_count > 0;

  let company_case: CompanyCase = 'no_company_data';

  if (has_company_column && unique_companies.length === 1) {
    company_case = 'single_company_column';
  } else if (has_company_column && unique_companies.length > 1) {
    company_case = 'multi_company_column';
  } else {
    company_case = 'no_company_data';
  }

  const needs_company_decision =
    company_case === 'multi_company_column' || company_case === 'no_company_data';

  const benefit_company_signals: string[] = []; // extension point

  return {
    parsedRows,
    row_count,
    invalid_row_count,
    has_company_column,
    unique_companies,
    missing_company_count,
    benefit_company_signals,
    company_case,
    needs_company_decision,
    has_invalid_rows
  };
}

function buildOptions(meta: {
  company_case: CompanyCase;
  unique_companies: string[];
}): BulkInspectOption[] {
  const opts: BulkInspectOption[] = [];

  if (meta.company_case === 'single_company_column') {
    opts.push({
      code: 'use_sheet_company',
      label: 'Use the company from the data for all rows. (validation will run during export)'
    });
    opts.push({
      code: 'generic_mode',
      label: 'Ignore company and generate generic objectives. (validation will run during export)'
    });
  } else if (meta.company_case === 'multi_company_column') {
    opts.push({
      code: 'keep_existing_companies',
      label: 'Keep the company in each row as-is. (validation will run during export)'
    });
    opts.push({
      code: 'generic_mode',
      label: 'Ignore company and generate generic objectives. (validation will run during export)'
    });
  } else {
    opts.push({
      code: 'generic_mode',
      label: 'No company info detected. Generate generic objectives. (validation will run during export)'
    });
  }

  return opts;
}

function buildPrompt(meta: {
  row_count: number;
  company_case: CompanyCase;
  unique_companies: string[];
}): string {
  const { row_count, company_case, unique_companies } = meta;

  if (company_case === 'single_company_column' && unique_companies.length === 1) {
    return `Detected ${row_count} row(s). All rows use company "${unique_companies[0]}". Choose how to proceed. (Note: full validation occurs during export.)`;
  }

  if (company_case === 'multi_company_column') {
    return `Detected ${row_count} row(s) with multiple companies (${unique_companies.join(
      ', '
    )}). Choose how to proceed. (Note: full validation occurs during export.)`;
  }

  return `Detected ${row_count} row(s). No reliable company column detected. Choose how to proceed. (Note: full validation occurs during export.)`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body as BulkInspectJsonRequest | undefined;

    let inputRows: KpiJsonRowIn[] = [];

    if (body) {
      if (
        typeof body.excel_csv_text === 'string' &&
        body.excel_csv_text.trim().length > 0
      ) {
        // CSV path (Custom GPT)
        inputRows = parseCsvToKpiJsonRows(body.excel_csv_text);
      } else if (Array.isArray(body.rows)) {
        // Legacy JSON rows path
        inputRows = body.rows;
      }
    }

    if (!inputRows || inputRows.length === 0) {
      return res.status(400).json({
        error: true,
        code: 'NO_ROWS',
        message:
          'bulkInspectJson received zero rows. Neither JSON rows nor CSV text contained data.'
      });
    }

    const {
      parsedRows,
      row_count,
      invalid_row_count,
      has_company_column,
      unique_companies,
      missing_company_count,
      benefit_company_signals,
      company_case,
      needs_company_decision,
      has_invalid_rows
    } = normalizeAndValidateRows(inputRows);

    if (row_count === 0) {
      return res.status(400).json({
        error: true,
        code: 'ONLY_EMPTY_ROWS',
        message: 'bulkInspectJson: all rows were empty after normalization.'
      });
    }

    // summaryMeta must match RowsTokenPayload['summaryMeta'] exactly
    const summaryMeta: RowsTokenPayload['summaryMeta'] = {
      row_count,
      invalid_row_count,
      has_company_column,
      unique_companies,
      missing_company_count,
      benefit_company_signals,
      company_case,
      needs_company_decision,
      has_invalid_rows
    };

    const rowsPayload: RowsTokenPayload = {
      parsedRows,
      summaryMeta
    };

    const rows_token = encodeRowsToken(rowsPayload);
    const ui_prompt = buildPrompt({
      row_count,
      company_case,
      unique_companies
    });
    const options = buildOptions({ company_case, unique_companies });

    const response: BulkInspectJsonResponse = {
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
      state: 'INSPECTED',
      ui_prompt,
      options
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('[bulkInspectJson] Unhandled error', err);

    return res.status(500).json({
      error: true,
      code: 'E902_BULK_INSPECT_INTERNAL',
      message: 'Bulk inspect failed due to an internal error. Please contact the KPI administrator.'
    });
  }
}