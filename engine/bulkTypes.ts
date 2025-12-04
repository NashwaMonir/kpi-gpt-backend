// engine/bulkTypes.ts
// Shared types for Bulk KPI Orchestration (v10.7.5-compatible)

import type { Mode } from './types';

export type BulkCompanyCase = 'NO_COLUMN' | 'SINGLE_COMPANY' | 'MULTI_COMPANY';

export type BulkFlowState =
  | 'NEED_COMPANY_DECISION'
  | 'NEED_MULTI_COMPANY_STRATEGY'
  | 'CONFIRM_SINGLE_COMPANY'
  | 'INVALID_ROWS_ACTION'
  | 'READY_FOR_OBJECTIVES'
  | 'ABORT_EMPTY_FILE'
  | 'ABORT_REUPLOAD';

export interface BulkUiOption {
  code: string;   // backend decision code, e.g. "ONE_COMPANY_ALL"
  label: string;  // text shown to the user
}

export interface ParsedRow {
  row_id: number;
  company?: string | null;
  team_role: string | null;
  task_type: string | null;
  task_name: string | null;
  dead_line: string | null;
  strategic_benefit: string | null;
  output_metric?: string | null;
  quality_metric?: string | null;
  improvement_metric?: string | null;
  mode?: Mode | string | null;
  // Optional validity flag (can be added by validation layer later)
  isValid?: boolean;
  invalidReason?: string;
}

export interface BulkInspectSummary {
  bulk_session_id: string;
  row_count: number;
  invalid_row_count: number;

  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;
  benefit_company_signals: string[];
  company_case: BulkCompanyCase;

  needs_company_decision: boolean;
  has_invalid_rows: boolean;

  state: BulkFlowState;
  ui_prompt: string;
  options: BulkUiOption[];
}

export interface BulkPrepareRowsRequest {
  bulk_session_id: string;
  selected_company: string;
  generic_mode: boolean;
  apply_to_missing: boolean;
  mismatched_strategy: 'keep' | 'overwrite';
  invalid_handling: 'skip' | 'abort';
}

export interface BulkPreparedRow {
  row_id: number;
  company?: string | null;
  team_role: string | null;
  task_type: string | null;
  task_name: string | null;
  dead_line: string | null;
  strategic_benefit: string | null;
  output_metric?: string | null;
  quality_metric?: string | null;
  improvement_metric?: string | null;
  mode?: Mode | string | null;
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  errorCodes: string[];
  resolved_metrics?: {
    output_metric?: string;
    quality_metric?: string;
    improvement_metric?: string;
    used_default_metrics: boolean;
  };
}

export interface BulkPrepareRowsResponse {
  bulk_session_id: string;
  state: BulkFlowState;
  ui_summary: string;
  rows: BulkPreparedRow[];
}

export interface BulkFinalizeExportRequest {
  bulk_session_id: string;
  objectives: Array<{
    row_id: number;
    simple_objective: string;
    complex_objective: string;
  }>;
}

export interface BulkFinalizeExportResponse {
  download_url: string;
  valid_count: number;
  needs_review_count: number;
  invalid_count: number;
  ui_message: string;
}