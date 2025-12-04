// engine/bulkTypes.ts
export type BulkSessionState = 'INSPECTED' | 'PREPARED' | 'FINALIZED';

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

export interface BulkInspectOption {
  code: string;
  label: string;
}

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

export interface BulkInspectSummary {
  bulk_session_id: string;

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

export interface BulkSessionMeta {
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
}

export interface BulkPreparedRow extends ParsedRow {
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  errorCodes: string[];
  resolved_metrics?:
    | {
        output_metric?: string | null;
        quality_metric?: string | null;
        improvement_metric?: string | null;
        used_default_metrics: boolean;
      }
    | null;
}

export interface BulkSessionSnapshot {
  state: BulkSessionState;
  rows: ParsedRow[];
  meta: BulkSessionMeta;
  preparedRows?: BulkPreparedRow[];
}

export interface BulkPrepareRowsRequest {
  bulk_session_id: string;
  selected_company: string;
  generic_mode: boolean;
  apply_to_missing: boolean;
  mismatched_strategy: 'keep' | 'overwrite';
  invalid_handling: 'skip' | 'abort';
}

export interface BulkPrepareRowsResponse {
  bulk_session_id: string;
  state: BulkSessionState;
  ui_summary: string;
  rows: BulkPreparedRow[];
}

export interface BulkFinalizeExportObjective {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
}

export interface BulkFinalizeExportRequest {
  bulk_session_id: string;
  objectives: BulkFinalizeExportObjective[];
}

export interface BulkFinalizeExportResponse {
  download_url: string;
  valid_count: number;
  needs_review_count: number;
  invalid_count: number;
  ui_message: string;
}