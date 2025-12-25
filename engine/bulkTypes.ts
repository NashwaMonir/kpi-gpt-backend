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

export type CompanyDecisionOption =
  | 'ROW_LEVEL'
  | 'SINGLE_COMPANY'
  | 'GENERIC_FOR_MISSING';

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

  /**
   * Indicates the row is *minimally complete* (required fields present).
   * This does NOT mean engine-valid.
   * Full validation (deadline rules, enums, dangerous text, metrics logic)
   * is enforced later in bulkFinalizeExport.
   */
  isValid: boolean;
  /**
   * Reason for minimal incompleteness only (e.g. missing required fields).
   * Not an engine-level validation error.
   */
  invalidReason?: string | null;
}

// After company strategies are applied
export interface PreparedRow extends ParsedRow {
  /**
   * Deterministic seed used by the objective engine for pattern/verb/variation selection.
   *
   * NOTE (v10.8): bulk must compute this AFTER canonical normalization
   * (team_role, task_type, and ISO `dead_line`) to ensure single vs bulk parity.
   */
  variation_seed?: number;
  /**
   * Canonical ISO deadline (YYYY-MM-DD) when available.
   *
   * NOTE (v10.8): `dead_line` remains the single source of truth.
   * These fields are optional helpers for downstream consumers
   * (objective engine / exports) that may prefer explicit ISO.
   */
  dead_line_iso?: string;
  dead_line_normalized?: string;

  /**
   * True when one or more metrics (output / quality / improvement)
   * were auto-suggested by the engine during export.
   *
   * NOTE (v10.8): This flag is authoritative only in bulkFinalizeExport.
   * Earlier bulk steps may leave it undefined.
   */
  metrics_auto_suggested?: boolean;
}
// -----------------------------
// Inspect summary and options
// -----------------------------

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

  /**
   * v10.8: Compact summary used by GPT to decide whether to ask the user.
   */
  company_summary: {
    unique_companies: string[];
    missing_company_count: number;
  };

  /**
   * v10.8: Enumerates valid UX decisions when company data is incomplete or mixed.
   */
  company_decision_options: CompanyDecisionOption[];

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
    company_summary: {
      unique_companies: string[];
      missing_company_count: number;
    };
    company_decision_options: CompanyDecisionOption[];
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
    company_summary: {
      unique_companies: string[];
      missing_company_count: number;
    };
    company_decision_options: CompanyDecisionOption[];
    benefit_company_signals: string[];
    company_case: CompanyCase;
    needs_company_decision: boolean;
    has_invalid_rows: boolean;
    state: BulkSessionState;
  };
  preparedRows: PreparedRow[];
}
export type CompanyPolicyMode = 'row_level' | 'single_company';
export type MissingCompanyPolicy = 'use_single_company' | 'generic';

export interface CompanyPolicy {
  mode: CompanyPolicyMode;
  single_company_name?: string | null;
  overwrite_existing_companies?: boolean; // default false
  missing_company_policy?: MissingCompanyPolicy; // default 'generic'
}
// API contracts

export interface BulkInspectJsonRequest {
  // Legacy/manual path: send JSON rows directly
  rows?: KpiJsonRowIn[];

  // GPT path: send raw CSV text for KPI_Input
  excel_csv_text?: string;
}

export interface BulkInspectJsonResponse extends BulkInspectSummary {}

export interface BulkPrepareRowsRequest {
  rows_token: string;

  selected_company?: string | null;
  generic_mode?: boolean;
  apply_to_missing?: boolean;
  mismatched_strategy?: 'keep' | 'overwrite';
  /**
   * Controls whether minimally incomplete rows are kept or skipped
   * during preparation.
   *
   * NOTE (v10.8 default): rows are kept so final export can emit
   * deterministic INVALID / NEEDS_REVIEW statuses.
   */
  invalid_handling?: 'skip' | 'keep';
  company_policy?: CompanyPolicy;
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
  /** Number of rows finalized as VALID */
  valid_count: number;
  /** Number of rows finalized as NEEDS_REVIEW */
  needs_review_count: number;
  /** Number of rows finalized as INVALID */
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
  row_id: number;
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;

  // Resolved metrics used to generate the objective (auto-suggested or user-provided)
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;

  // Audit flag: true when one or more metrics were auto-filled by the engine
  metrics_auto_suggested: boolean;

  /**
   * Final, authoritative objective selected by the engine
   * (simple or complex, depending on the contract rules).
   */
  objective: string;
  validation_status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';

  /** v10.8 Lite: always a single HR-grade string (never an array). */
  comments: string;

  /**
   * Legacy field (pre-v10.8 Lite). Optional and ignored by v10.8 Lite exports.
   * Prefer removing when all downstream consumers are migrated.
   */
  summary_reason?: string;
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

export function encodeRowsForDownload(rows: KpiResultRow[]): string {
  const json = JSON.stringify(rows);
  const token = toBase64Url(json);
  return `/api/runKpiResultDownload?data=${encodeURIComponent(token)}`;
}
