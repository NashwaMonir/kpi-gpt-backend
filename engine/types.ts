// engine/types.ts
// Shared TypeScript interfaces for the KPI Engine (v10.7.5 with Option C-FULL)


export type Mode = 'simple' | 'complex' | 'both';

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
  mode?: Mode | string | null | undefined;
}

export interface KpiRequest {
  engine_version?: string;
  default_company?: string;
  rows: KpiRowIn[];
}

export interface KpiRowOut {
  row_id: number;
  simple_objective: string;
  complex_objective: string;
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  error_codes: string[];    // New for Option C-FULL
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
  invalidText: string[];
}
// engine/types.ts

export interface DomainValidationResult {
  // Normalized input row (trimmed/normalized fields).
  normalizedRow: KpiRowIn;

  // Per-field validation details.
  fieldChecks: FieldCheckResult;
  deadline: DeadlineParseResult;

  // Mode after normalization and validation.
  mode: Mode;
  modeWasInvalid: boolean;

  // Sanitized strings used by metrics/assembler.
  safeOutput: string;
  safeQuality: string;
  safeImprovement: string;
  safeCompany: string;
  safeStrategicBenefit: string;

  // Domain-level status hint.
  statusHint: 'VALID' | 'INVALID';
  hasBlockingErrors: boolean;
}