// engine/types.ts
// Shared TypeScript interfaces for the KPI Engine (v10.8)
import type { ErrorCode } from './errorCodes';

/**
 * Effective objective mode used by the engine.
 * This is what external clients should rely on.
 */
export type ObjectiveMode = 'simple' | 'complex';

/**
 * Legacy/ internal mode hint.
 * - In v10.8, users MUST NOT provide mode.
 * - Domain validation may still use 'both' internally as a hint,
 *   but the effective mode is always computed inside objectiveEngine
 *   via decideEffectiveMode (lead role, metrics_auto_suggested, strategic benefit, missing metrics).
 */
export type Mode = 'simple' | 'complex' | 'both';

export interface ResolvedMetricsSnapshot {
  output_metric?: string;
  quality_metric?: string;
  improvement_metric?: string;
}

/**
 * KpiRowIn – transport-level input row, as received from /api/kpi or bulk flows.
 * In v10.8:
 * - Users must NOT provide mode or baseline.
 * - Metrics are optional; missing metrics trigger auto-suggest + NEEDS_REVIEW.
 */
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

  /**
   * Deprecated in v10.8:
   * - User-provided mode hints are NOT part of the public contract and MUST be ignored
   *   when present.
   * - Effective mode is always computed in objectiveEngine.ts.
   * Kept only for backward compatibility at the transport layer.
   */
  mode?: Mode;
}

/**
 * PreparedRow – normalized + resolved row passed into objectiveEngine.
 * Canonical engine-row shape (single + bulk must converge on this type).
 * - All strings are normalized (never null/undefined).
 * - Metrics are final text values after validation / auto-suggest.
 * - metrics_auto_suggested is always a concrete boolean.
 */
export interface PreparedRow {
  row_id: number;
  team_role: string;
  task_type: string;
  task_name: string;
  dead_line: string;
  strategic_benefit: string;
  company: string;

  output_metric: string;
  quality_metric: string;
  improvement_metric: string;

  /**
   * True when any of the three metrics (output/quality/improvement)
   * were auto-suggested by the engine (matrix or role defaults)
   * rather than provided directly by the user.
   * This is used by objectiveEngine to force complex mode and, together with
   * metrics error codes, to drive NEEDS_REVIEW status.
   */
  metrics_auto_suggested: boolean;

  variation_seed: number;
}

/**
 * ObjectiveOutput – internal engine output containing both variants.
 * Only one of simple_objective / complex_objective is populated for a given row,
 * depending on the effective mode computed by decideEffectiveMode.
 */
export interface ObjectiveOutput {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
}

/**
 * KpiRowOut – final row returned by the engine to API layer.
 * - simple_objective / complex_objective are internal/debug fields.
 * - objective + objective_mode are the canonical external outputs.
 */
export interface KpiRowOut {
  row_id: number;

  /**
   * Simple objective variant (populated only when the engine decides
   * the effective mode is simple). Kept for internal use/debugging.
   */
  simple_objective?: string;

  /**
   * Complex objective variant (populated only when the engine decides
   * the effective mode is complex). Kept for internal use/debugging.
   */
  complex_objective?: string;

  /**
   * Final, authoritative objective selected by the engine
   * (simple or complex, depending on the contract rules).
   * This is the field that should be exposed to Excel exports and
   * most external clients.
   *
   * For INVALID rows, this MUST be an empty string.
   */
  objective: string;

  /**
   * Effective mode used to generate the final objective.
   * - "simple" or "complex" for VALID / NEEDS_REVIEW rows.
   * - When status === 'INVALID':
   *   - objective MUST be ""
   *   - objective_mode MUST be "" (empty string)
   */
  objective_mode: ObjectiveMode | '';

  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';

  /**
   * Detailed comments from the validator / engine.
   * Single HR-grade string in v10.8 Lite.
   */
  comments: string;

  /**
   * Deprecated in v10.8 Lite.
   * Kept optional for backward compatibility with older exports/clients.
   */
  summary_reason?: string;

  /**
   * Machine-readable error codes (Exxx) describing validation issues
   * or NEEDS_REVIEW drivers.
   */
  error_codes: ErrorCode[];

  /**
   * Optional resolved metrics snapshot exposed to GPT / clients.
   * Contains the final output/quality/improvement metric strings
   * after domain validation and metrics auto-suggest.
   */
  resolved_metrics?: ResolvedMetricsSnapshot;

  /**
   * True when any metric was auto-suggested by the engine.
   * Mirrors PreparedRow.metrics_auto_suggested for client visibility.
   */
  metrics_auto_suggested: boolean;

  // Global seed for deterministic variation.
  variation_seed: number;
}

export interface KpiRequest {
  rows: KpiRowIn[];
  /**
   * Engine version requested by the client.
   * For v10.8 flows, this should be "v10.8".
   */
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
  invalidText?: string[];
}

/**
 * DomainValidationResult – internal structure used by validateDomain.
 * This is NOT exposed externally and may keep legacy hints like mode.
 */
export interface DomainValidationResult {
  inputRow: KpiRowIn;

  normalizedRow: KpiRowIn;

  fieldChecks: FieldCheckResult;

  dangerousMetrics: string[];

  deadline: DeadlineParseResult;

  /**
   * Internal/legacy mode hint from domain validation.
   * Effective objective mode is computed later by objectiveEngine
   * and exposed as KpiRowOut.objective_mode.
   */
  mode: Mode;
  modeWasInvalid: boolean;

  safeOutput: string;
  safeQuality: string;
  safeImprovement: string;
  safeCompany: string;
  safeStrategicBenefit: string;

  /**
   * High-level status hint (VALID/INVALID) used by downstream logic.
   * Final status is computed by combining this with metrics status,
   * error codes, etc.
   */
  statusHint: 'VALID' | 'INVALID';

  hasBlockingErrors: boolean;
}