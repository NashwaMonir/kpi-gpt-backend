// engine/bulkTypes.ts
// Core bulk types + token helpers for JSON-based bulk flow (v10.7.5).

//
// Session state
//
export type BulkSessionState =
  | 'INSPECTED'
  | 'READY_FOR_OBJECTIVES'
  | 'FINALIZED';

//
// Raw row input (JSON form after Excel parsing)
//
export interface KpiJsonRowIn {
  row_id: number;
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

//
// Parsed row used inside bulk pipeline
//
export interface ParsedRow {
  row_id: number;
  company: string | null;
  team_role: string | null;
  task_type: string | null;
  task_name: string | null;
  dead_line: string | null;
  strategic_benefit: string | null;
  output_metric: string | null;
  quality_metric: string | null;
  improvement_metric: string | null;
  mode: 'simple' | 'complex' | 'both';
  isValid: boolean;
  invalidReason?: string | null;
}

// Inspect summary (used by bulkInspectJson response)
//
export interface BulkInspectOption {
  code: string;
  label: string;
}
// Excel inspection result (used by parseKpiInputExcel)
export interface ParsedExcelInspectionResult {
  rows: ParsedRow[];
  row_count: number;
  invalid_row_count: number;

  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;

  benefit_company_signals: string[];

  company_case:
    | 'no_company_data'
    | 'single_company_column'
    | 'multi_company_column'
    | 'benefit_signal_only';

  needs_company_decision: boolean;
  has_invalid_rows: boolean;

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
    company_case:
      | 'no_company_data'
      | 'single_company_column'
      | 'multi_company_column'
      | 'benefit_signal_only';
    needs_company_decision: boolean;
    has_invalid_rows: boolean;
  };
}
export interface BulkInspectSummary {
  rows_token: string;

  row_count: number;
  invalid_row_count: number;

  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;

  benefit_company_signals: string[];

  company_case:
    | 'no_company_data'
    | 'single_company_column'
    | 'multi_company_column'
    | 'benefit_signal_only';

  needs_company_decision: boolean;
  has_invalid_rows: boolean;

  state: BulkSessionState;
  ui_prompt: string;
  options: BulkInspectOption[];
}

//
// Stateless token payloads for bulk flow
//

// Token used for rows_token (output of bulkInspectJson)
/*export interface BulkInspectTokenPayload {
  parsedRows: ParsedRow[];
  summary: BulkInspectSummary;
}*/

// Prepared rows extend ParsedRow (extension point)
export interface BulkPreparedRow extends ParsedRow {
  // Extension point: add per-row bulk flags in future if needed
}

// Token used for prep_token (output of bulkPrepareRows)
export interface BulkPrepareTokenPayload {
  summary: RowsTokenPayload['summaryMeta'] & { state: BulkSessionState };
  preparedRows: BulkPreparedRow[];
}

//
// API contracts: bulkPrepareRows
//
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
  prepared_rows: BulkPreparedRow[];
}

//
// API contracts: bulkFinalizeExport
//
export interface BulkObjectiveInput {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
}

export interface BulkFinalizeExportRequest {
  prep_token: string;
  objectives: BulkObjectiveInput[];
}

export interface BulkFinalizeExportResponse {
  download_url: string;
  valid_count: number;
  needs_review_count: number;
  invalid_count: number;
  ui_message: string;
}

//
// Shape for rows passed to runKpiResultDownload (Excel export)
//
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

//
// Base64-url helpers (internal)
//
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

//
// ⸻ Base64-url encode/decode for rows_token (stateless) ⸻

export function encodeRowsToken(payload: RowsTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodeRowsToken(token: string): RowsTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as RowsTokenPayload;
}
// Stateless tokens for bulk flow
//
/*export function encodeInspectToken(payload: BulkInspectTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodeInspectToken(token: string): BulkInspectTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as BulkInspectTokenPayload;
}*/

export function encodePrepareToken(payload: BulkPrepareTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodePrepareToken(token: string): BulkPrepareTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as BulkPrepareTokenPayload;
}

//
// Helper for building runKpiResultDownload URL payload
//
export function encodeRowsForDownload(
  rows: KpiResultRow[],
  host?: string | null
): string {
  const json = JSON.stringify(rows);
  const token = toBase64Url(json);

  if (!host || host.trim().length === 0) {
    // If host not provided, just return the token part; caller can build full URL.
    return `/api/runKpiResultDownload?data=${encodeURIComponent(token)}`;
  }

  return `https://${host}/api/runKpiResultDownload?data=${encodeURIComponent(
    token
  )}`;
}