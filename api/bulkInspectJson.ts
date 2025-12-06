// api/bulkInspectJson.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
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

function toStringSafe(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeMode(raw: string): 'simple' | 'complex' | 'both' {
  const v = raw.toLowerCase();
  if (v === 'simple') return 'simple';
  if (v === 'complex') return 'complex';
  return 'both';
}

function normalizeAndValidateRows(rows: KpiJsonRowIn[]): {
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
    // Mandatory fields for validity
    const team_role = toStringSafe(raw.team_role);
    const task_type = toStringSafe(raw.task_type);
    const task_name = toStringSafe(raw.task_name);
    const dead_line = toStringSafe(raw.dead_line);

    const company = toStringSafe(raw.company);
    const strategic_benefit = toStringSafe(raw.strategic_benefit);
    const output_metric = toStringSafe(raw.output_metric);
    const quality_metric = toStringSafe(raw.quality_metric);
    const improvement_metric = toStringSafe(raw.improvement_metric);
    const modeStr = normalizeMode(toStringSafe(raw.mode) || 'both');

    if (company.length > 0) {
      has_company_column = true;
      companySet.add(company);
    } else {
      missing_company_count += 1;
    }

    const isValid =
      !!team_role &&
      !!task_type &&
      !!task_name &&
      !!dead_line;

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
      mode: modeStr,
      isValid,
      invalidReason: isValid ? undefined : 'Missing mandatory fields'
    };

    // Skip rows that are completely empty (no task_name, no team_role, etc.)
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

  const benefit_company_signals: string[] = []; // extension point for NLP on strategic_benefit

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

function buildOptions(
  meta: {
    company_case: CompanyCase;
    unique_companies: string[];
  }
): BulkInspectOption[] {
  const opts: BulkInspectOption[] = [];

  if (meta.company_case === 'single_company_column') {
    opts.push({
      code: 'use_sheet_company',
      label: 'Use the company from the data for all rows.'
    });
    opts.push({
      code: 'generic_mode',
      label: 'Ignore company and generate generic objectives.'
    });
  } else if (meta.company_case === 'multi_company_column') {
    opts.push({
      code: 'keep_existing_companies',
      label: 'Keep the company in each row as-is.'
    });
    opts.push({
      code: 'generic_mode',
      label: 'Ignore company and generate generic objectives.'
    });
  } else {
    opts.push({
      code: 'generic_mode',
      label: 'No company info detected. Generate generic objectives.'
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
    return `Detected ${row_count} row(s). All rows use company "${unique_companies[0]}". Choose how to proceed.`;
  }

  if (company_case === 'multi_company_column') {
    return `Detected ${row_count} row(s) with multiple companies (${unique_companies.join(
      ', '
    )}). Choose how to proceed.`;
  }

  return `Detected ${row_count} row(s). No reliable company column detected. Choose how to proceed.`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as BulkInspectJsonRequest | undefined;

  if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'NO_ROWS',
      message: 'bulkInspectJson received zero rows. GPT did not send any parsed KPI data.'
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
  } = normalizeAndValidateRows(body.rows);

  if (row_count === 0) {
    return res.status(400).json({
      error: true,
      code: 'ONLY_EMPTY_ROWS',
      message: 'bulkInspectJson: all rows were empty after normalization.'
    });
  }

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
}