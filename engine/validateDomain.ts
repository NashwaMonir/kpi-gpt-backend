// engine/validateDomain.ts
// Domain-level validation for KPI Engine v10.8.
//
// Responsibilities (per row):
//  - Normalize Task Type and Team Role (case-insensitive, canonical forms)
//  - Identify missing mandatory fields
//  - Identify invalid enum values (Task Type, Team Role)
//  - Validate Company, Strategic Benefit, and metrics content (dangerous / low-semantic)
//  - Validate Deadline format and calendar year
//  - Normalize Mode (user hint only) with fallback and error code on invalid
//
// This module DOES NOT:
//  - Decide final status (VALID / NEEDS_REVIEW / INVALID)
//  - Build comments / summary_reason (handled in buildErrorMessage.ts)
//  - Apply metric auto-suggest (handled in metricsAutoSuggest.ts)

import type {
  KpiRowIn,
  Mode,
  DeadlineParseResult,
  FieldCheckResult,
  DomainValidationResult
} from './types';

import {
  MANDATORY_FIELD_ORDER,
  INVALID_VALUE_ORDER,
  INVALID_TEXT_ORDER
} from './constants';
import type { ErrorCode } from './errorCodes';
import { ErrorCodes, addErrorCode } from './errorCodes';
import {
  toSafeTrimmedString,
  normalizeTaskType,
  normalizeTeamRole,
  normalizeMode,
  normalizeDeadline
} from './normalizeFields';
import {
  checkDangerousText,
  evaluateMetricsDangerous,
} from './validateDangerous';
import { validateDeadline } from './validateDeadline';


/**
 * Main entry point: validate a single KPI row at the domain level.
 *
 * - Mutates errorCodes[] with appropriate codes.
 * - Returns a normalized row + structured lists of issues.
 * - Adds hasBlockingErrors + statusHint for the assembler.
 */
export function validateDomain(
  row: KpiRowIn,
  errorCodes: ErrorCode[]
): DomainValidationResult {
  // Work on a shallow copy so we keep immutability expectations clear.
  const normalizedRow: KpiRowIn = { ...row };

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const invalidTextFields: string[] = [];

  // -----------------------------
  // 1) Normalize and check core string fields
  // -----------------------------

  const safeTaskName = toSafeTrimmedString(row.task_name);
  const safeTaskType = toSafeTrimmedString(row.task_type);
  const safeTeamRole = toSafeTrimmedString(row.team_role);
  const safeDeadline = toSafeTrimmedString(row.dead_line);
  const safeStrategicBenefit = toSafeTrimmedString(row.strategic_benefit);
  const safeCompany = toSafeTrimmedString(row.company ?? '');

  const safeOutput = toSafeTrimmedString(row.output_metric ?? '');
  const safeQuality = toSafeTrimmedString(row.quality_metric ?? '');
  const safeImprovement = toSafeTrimmedString(row.improvement_metric ?? '');


    // ----------------------------------------------------
  // Dangerous / low-signal metrics (Output / Quality / Improvement)
  // ----------------------------------------------------
  const { dangerousMetrics } = evaluateMetricsDangerous(
    safeOutput,
    safeQuality,
    safeImprovement,
    errorCodes
  );

  // ---- Task Name (mandatory) ----
  if (!safeTaskName) {
    missingFields.push('Task Name');
    addErrorCode(errorCodes, ErrorCodes.MISSING_TASK_NAME);
  } else {
    normalizedRow.task_name = safeTaskName;
  }

  // ---- Task Type (mandatory + allowed values) ----
  if (!safeTaskType) {
    missingFields.push('Task Type');
    addErrorCode(errorCodes, ErrorCodes.MISSING_TASK_TYPE);
  } else {
    const { normalized, isAllowed } = normalizeTaskType(safeTaskType);
    normalizedRow.task_type = normalized;

    if (!isAllowed) {
      invalidFields.push('Task Type');
      addErrorCode(errorCodes, ErrorCodes.INVALID_TASK_TYPE);
    }
  }

  // ---- Team Role (mandatory + allowed values) ----
  if (!safeTeamRole) {
    missingFields.push('Team Role');
    addErrorCode(errorCodes, ErrorCodes.MISSING_TEAM_ROLE);
  } else {
    const { normalized, isAllowed } = normalizeTeamRole(safeTeamRole);
    normalizedRow.team_role = normalized;

    if (!isAllowed) {
      invalidFields.push('Team Role');
      addErrorCode(errorCodes, ErrorCodes.INVALID_TEAM_ROLE);
    }
  }

  // ---- Strategic Benefit (mandatory + content) ----
  if (!safeStrategicBenefit) {
    missingFields.push('Strategic Benefit');
    addErrorCode(errorCodes, ErrorCodes.MISSING_STRATEGIC_BENEFIT);
  } else {
    const { isDangerous, isLowSemantic } = checkDangerousText(
      safeStrategicBenefit,
      'Strategic Benefit',
      errorCodes
    );

    if (isDangerous || isLowSemantic) {
      invalidTextFields.push('Strategic Benefit');
    }

    normalizedRow.strategic_benefit = safeStrategicBenefit;
  }

  // -----------------------------
  // 2) Company content validation (optional, but must be valid if present)
  // -----------------------------
  if (safeCompany) {
    const { isDangerous, isLowSemantic } = checkDangerousText(
      safeCompany,
      'Company',
      errorCodes
    );
    if (isDangerous || isLowSemantic) {
      invalidTextFields.push('Company');
    }
    // valid, non-empty company string
    normalizedRow.company = safeCompany;
  } else {
    // treat empty/undefined as null in normalized row
    normalizedRow.company = null;
  }
  /*
  // If you want to reuse the helpers, you can later switch to:
  if (safeCompany) {
  if (isDangerousCompanyText(safeCompany, errorCodes)) {
    invalidTextFields.push('Company');
  }
  normalizedRow.company = safeCompany;
}*/

  // -----------------------------
  // 3) Metrics normalization
  // -----------------------------
  // Dangerous / low-signal content is already captured via evaluateMetricsDangerous()
  // and surfaced as `dangerousMetrics`. Here we only normalize to strings.
  normalizedRow.output_metric = safeOutput || '';
  normalizedRow.quality_metric = safeQuality || '';
  normalizedRow.improvement_metric = safeImprovement || '';

  // -----------------------------
  // 4) Deadline validation (mandatory + multi-format + year rule)
  // -----------------------------
  let deadlineResult: DeadlineParseResult = {
    valid: false,
    wrongYear: false,
    date: null
  };

  if (!safeDeadline) {
    missingFields.push('Deadline');
    addErrorCode(errorCodes, ErrorCodes.MISSING_DEADLINE);
  } else {
    deadlineResult = validateDeadline(safeDeadline, errorCodes);

    // Persist normalized ISO everywhere (single source of truth)
    if (deadlineResult.valid) {
      const n = normalizeDeadline(safeDeadline);

      const isoFromValidator =
        deadlineResult.date instanceof Date
          ? `${deadlineResult.date.getUTCFullYear()}-${String(
              deadlineResult.date.getUTCMonth() + 1
            ).padStart(2, '0')}-${String(deadlineResult.date.getUTCDate()).padStart(2, '0')}`
          : null;

      const iso = (n.isValid && n.normalized) || isoFromValidator;

      if (iso) {
        normalizedRow.dead_line = iso;
        (normalizedRow as any).dead_line_iso = iso;
        (normalizedRow as any).dead_line_normalized = iso;
      }
    }
  }

  // -----------------------------
  // 5) Mode normalization (simple / complex / both, with fallback)
  // -----------------------------
  const safeMode = toSafeTrimmedString(row.mode);
  const modeNormalizeResult = normalizeMode(safeMode, errorCodes);
  const normalizedMode: Mode = modeNormalizeResult.mode;
  const modeWasInvalid: boolean = modeNormalizeResult.wasInvalid;

  // -----------------------------
  // 6) Sort field lists to canonical order (for stable messaging)
  // -----------------------------
  missingFields.sort(
    (a, b) => MANDATORY_FIELD_ORDER.indexOf(a) - MANDATORY_FIELD_ORDER.indexOf(b)
  );

  invalidFields.sort(
    (a, b) => INVALID_VALUE_ORDER.indexOf(a) - INVALID_VALUE_ORDER.indexOf(b)
  );

  invalidTextFields.sort(
    (a, b) => INVALID_TEXT_ORDER.indexOf(a) - INVALID_TEXT_ORDER.indexOf(b)
  );

  const fieldChecks: FieldCheckResult = {
  missing: missingFields,
  invalid: invalidFields,
  invalidText: invalidTextFields,  // ← this array you push into earlier
};

  // ---------------------------------------------
  // 7) Compute hasBlockingErrors + statusHint
  // ---------------------------------------------
  // Per 07_Domain_Validation_Spec and 06_System_error_spec:
  //  - Any missing mandatory fields (E2xx)
  //  - Any invalid values/formats (E3xx)
  //  - Any dangerous/low-signal text issues (E4xx)
  //  - Any deadline issues (BAD_FORMAT or WRONG_YEAR)
  // must mark the row as INVALID at the domain layer.
    const hasBlockingErrors =
    missingFields.length > 0 ||
    invalidFields.length > 0 ||
    invalidTextFields.length > 0 ||
    dangerousMetrics.length > 0 ||   // dangerous metrics are blocking
    !deadlineResult.valid ||
    deadlineResult.wrongYear;
    
const statusHint: 'VALID' | 'INVALID' = hasBlockingErrors ? 'INVALID' : 'VALID';
  // ---------------------------------------------
  // 8) Return structured result
  // ---------------------------------------------
  return {
  inputRow: row,                     // ← add this
  normalizedRow,
  fieldChecks,
  dangerousMetrics,             // keep this
  deadline: deadlineResult,
  mode: normalizedMode,
  modeWasInvalid,
  safeOutput,
  safeQuality,
  safeImprovement,
  safeCompany,
  safeStrategicBenefit,
  statusHint,
  hasBlockingErrors
};
}