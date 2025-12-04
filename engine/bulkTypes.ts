// engine/bulkTypes.ts
// Shared types for SMART KPI bulk flow (token-based, Option 2)

// ⸻ Core row types ⸻

export type BulkSessionState = 'INSPECTED' | 'READY_FOR_OBJECTIVES' | 'FINALIZED';

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
  invalidReason?: string;
}

// ⸻ Excel inspection result (used by parseKpiInputExcel) ⸻

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
  options: { code: string; label: string }[];
}

// ⸻ Bulk inspection summary used in tokens / API ⸻

export interface BulkInspectOption {
  code: string;
  label: string;
}

export interface BulkInspectSummary {
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

// ⸻ Token payloads for stateless bulk flow ⸻

export interface BulkInspectTokenPayload {
  parsedRows: ParsedRow[];
  summary: BulkInspectSummary;
}

export interface BulkPreparedRow extends ParsedRow {
  // Extension point: add per-row bulk flags in future if needed
}

export interface BulkPrepareTokenPayload {
  summary: BulkInspectSummary;
  preparedRows: BulkPreparedRow[];
}

// ⸻ API contracts: bulkPrepareRows ⸻

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

// ⸻ API contracts: bulkFinalizeExport ⸻

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

// ⸻ Shape for result rows used in Excel export / download ⸻

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

// ⸻ Base64 URL helpers (for tokens and download payload) ⸻

function toBase64Url(input: string): string {
  const base64 = Buffer.from(input, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const padLength = (4 - (input.length % 4)) % 4;
  const padded = input + '='.repeat(padLength);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

// ⸻ Stateless tokens for bulk flow ⸻

export function encodeInspectToken(payload: BulkInspectTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodeInspectToken(token: string): BulkInspectTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as BulkInspectTokenPayload;
}

export function encodePrepareToken(payload: BulkPrepareTokenPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodePrepareToken(token: string): BulkPrepareTokenPayload {
  const json = fromBase64Url(token);
  return JSON.parse(json) as BulkPrepareTokenPayload;
}

// ⸻ Helper for building runKpiResultDownload URL payload ⸻

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