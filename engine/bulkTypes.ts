// engine/bulkTypes.ts

export type BulkSessionState =
  | 'INSPECTED'
  | 'READY_FOR_OBJECTIVES'
  | 'FINALIZED';

export type CompanyCase =
  | 'no_company_data'
  | 'single_company_column'
  | 'multi_company_column'
  | 'benefit_signal_only';

// Input row shape from GPT (Step 1 JSON payload)
export interface KpiJsonRowIn {
  row_id?: number;

  company?: string | null;
  team_role?: string | null;
  task_type?: string | null;
  task_name?: string | null;
  dead_line?: string | null;
  strategic_benefit?: string | null;
  output_metric?: string | null;
  quality_metric?: string | null;
  improvement_metric?: string | null;
  mode?: string | null;
}

// Normalized / parsed row used by bulk engine
export interface ParsedRow {
  row_id: number;

  company: string;
  team_role: string;
  task_type: string;
  task_name: string;
  dead_line: string;
  strategic_benefit: string;
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;
  mode: 'simple' | 'complex' | 'both';

  isValid: boolean;
  invalidReason?: string | null;
}

// After company strategies are applied
export interface PreparedRow extends ParsedRow {}

// Inspect summary and options

export interface BulkInspectOption {
  code: string;
  label: string;
}

export interface BulkInspectSummary {
  rows_token: string;

  row_count: number;
  invalid_row_count: number;

  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;

  benefit_company_signals: string[];

  company_case: CompanyCase;

  needs_company_decision: boolean;
  has_invalid_rows: boolean;

  state: BulkSessionState;
  ui_prompt: string;
  options: BulkInspectOption[];
}

export interface RowsTokenPayload {
  parsedRows: ParsedRow[];
  summaryMeta: {
    row_count: number;
    invalid_row_count: number;
    has_company_column: boolean;
    unique_companies: string[];
    missing_company_count: number;
    benefit_company_signals: string[];
    company_case: CompanyCase;
    needs_company_decision: boolean;
    has_invalid_rows: boolean;
  };
}

export interface BulkPrepareTokenPayload {
  summary: {
    row_count: number;
    invalid_row_count: number;
    has_company_column: boolean;
    unique_companies: string[];
    missing_company_count: number;
    benefit_company_signals: string[];
    company_case: CompanyCase;
    needs_company_decision: boolean;
    has_invalid_rows: boolean;
    state: BulkSessionState;
  };
  preparedRows: PreparedRow[];
}

// API contracts

export interface BulkInspectJsonRequest {
  rows: KpiJsonRowIn[];
}

export interface BulkInspectJsonResponse extends BulkInspectSummary {}

export interface BulkPrepareRowsRequest {
  rows_token: string;

  selected_company?: string | null;
  generic_mode?: boolean;
  apply_to_missing?: boolean;
  mismatched_strategy?: 'keep' | 'overwrite';
  invalid_handling?: 'skip' | 'include';
}

export interface BulkPrepareRowsResponse {
  prep_token: string;
  state: BulkSessionState;

  row_count: number;
  valid_row_count: number;
  invalid_row_count: number;
  needs_review_count: number;

  ui_summary: string;
  prepared_rows: PreparedRow[];
}

export interface BulkFinalizeExportRequest {
  prep_token: string;
}

export interface BulkFinalizeExportResponse {
  download_url: string;
  valid_count: number;
  needs_review_count: number;
  invalid_count: number;
  ui_message: string;
}

// Objective engine output

export interface ObjectiveOutput {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
}

// Shape for result rows used by runKpiResultDownload

export interface KpiResultRow {
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;
  simple_objective: string;
  complex_objective: string;
  validation_status: string;
  comments: string;
  summary_reason: string;
}

// Base64-url helpers

function toBase64Url(json: string): string {
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): string {
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Encode/decode for rows_token

export function encodeRowsToken(payload: RowsTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodeRowsToken(token: string): RowsTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as RowsTokenPayload;
}

// Encode/decode for prep_token

export function encodePrepareToken(payload: BulkPrepareTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodePrepareToken(token: string): BulkPrepareTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as BulkPrepareTokenPayload;
}

// Helper for building runKpiResultDownload URL payload

export function encodeRowsForDownload(
  rows: KpiResultRow[],
  host?: string | null
): string {
  const json = JSON.stringify(rows);
  const token = toBase64Url(json);

  const path = `/api/runKpiResultDownload?data=${encodeURIComponent(token)}`;

  if (!host || host.trim().length === 0) {
    return path;
  }

  return `https://${host}${path}`;
}