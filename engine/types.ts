// engine/types.ts
// Shared TypeScript interfaces for the KPI Engine (v10.7.5 with Option C-FULL)

/*import type { MatrixKey } from './metricMatrixResolver';
import type { MetricResolutionResult } from './metricsAutoSuggest';*/

export type Mode = 'simple' | 'complex' | 'both';
import type { ErrorCode } from './errorCodes';

export interface ResolvedMetricsSnapshot {
  output_metric?: string;
  quality_metric?: string;
  improvement_metric?: string;
}

export interface KpiRowIn {
  row_id: number;

  // Company may be omitted or null; treated via preflight/generic mode.
  company?: string | null;

  // Mandatory string fields (nullable/undefined allowed at transport layer).
  team_role: string | null | undefined;
  task_type: string | null | undefined;
  task_name: string | null | undefined;
  dead_line: string | null | undefined;
  strategic_benefit: string | null | undefined;

  // Optional metric fields — always treated as string | null | undefined at transport layer.
  output_metric?: string | null | undefined;
  quality_metric?: string | null | undefined;
  improvement_metric?: string | null | undefined;

  // Mode: user can pass string, null, or undefined; domain validator normalizes to Mode.
  mode?: Mode;
}

// NEW: PreparedRow passes normalized + resolved metrics into objectiveEngine
export interface PreparedRow {
  row_id: number;
  team_role: string;
  task_type: string;
  task_name: string;
  dead_line: string;
  strategic_benefit: string;
  company: string;
  mode: Mode;

  output_metric: string;
  quality_metric: string;
  improvement_metric: string;

  variation_seed: number;
}

export interface ObjectiveOutput {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
}

// Existing KpiRowOut – EXTEND with variation_seed + resolved_metrics + objectives
export interface KpiRowOut {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  error_codes: ErrorCode[] ; // New for Option C-FULL

  /**
   * Optional resolved metrics snapshot exposed to GPT / clients.
   * Contains the final output/quality/improvement metric strings
   * after domain validation and metrics auto-suggest.
   */
  resolved_metrics?: ResolvedMetricsSnapshot;

  // NEW mandatory field for global seed
  variation_seed: number;
}

export interface KpiRequest {
  rows: KpiRowIn[];
  engine_version?: string;
  default_company?: string;
}

export interface KpiResponse {
  rows: KpiRowOut[];
}

export interface DeadlineParseResult {
  valid: boolean;
  wrongYear: boolean;
  date: Date | null;
}

export interface FieldCheckResult {
  missing: string[];
  invalid: string[];
  invalidText?: string[]; // domain-level invalid text fields (Company, Strategic Benefit, etc.)
}

export interface DomainValidationResult {
  inputRow: KpiRowIn;              // ← REQUIRED
  normalizedRow: KpiRowIn;
  fieldChecks: FieldCheckResult;
  dangerousMetrics: string[];
  deadline: DeadlineParseResult;
  mode: Mode;
  modeWasInvalid: boolean;
  safeOutput: string;
  safeQuality: string;
  safeImprovement: string;
  safeCompany: string;
  safeStrategicBenefit: string;
  statusHint: 'VALID' | 'INVALID';
  hasBlockingErrors: boolean;
}