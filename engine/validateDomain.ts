// engine/validateDomain.ts
// Domain-level validation for KPI Engine v10.7.5 (Option C-FULL)
//
// Responsibilities (per row):
//  - Normalize Task Type and Team Role (case-insensitive, canonical forms)
//  - Identify missing mandatory fields
//  - Identify invalid enum values (Task Type, Team Role)
//  - Validate Company, Strategic Benefit, and metrics content (dangerous / low-semantic)
//  - Validate Deadline format and calendar year
//  - Normalize Mode with fallback and error code on invalid
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
  normalizeMode
} from './normalizeFields';
import { checkDangerousText } from './validateDangerous';
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

    normalizedRow.company = safeCompany;
  }

  // -----------------------------
  // 3) Metrics content validation (if present)
  // -----------------------------
  if (safeOutput) {
    const { isDangerous, isLowSemantic } = checkDangerousText(
      safeOutput,
      'Output',
      errorCodes
    );
    if (isDangerous || isLowSemantic) {
      invalidTextFields.push('Output');
    }
  }
  // Always normalize to a string (never undefined)
  normalizedRow.output_metric = safeOutput || '';

  if (safeQuality) {
    const { isDangerous, isLowSemantic } = checkDangerousText(
      safeQuality,
      'Quality',
      errorCodes
    );
    if (isDangerous || isLowSemantic) {
      invalidTextFields.push('Quality');
    }
  }
  // Always normalize to a string (never undefined)
  normalizedRow.quality_metric = safeQuality || '';

  if (safeImprovement) {
    const { isDangerous, isLowSemantic } = checkDangerousText(
      safeImprovement,
      'Improvement',
      errorCodes
    );
    if (isDangerous || isLowSemantic) {
      invalidTextFields.push('Improvement');
    }
  }
  // Always normalize to a string (never undefined)
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
    normalizedRow.dead_line = safeDeadline;
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
    invalidText: invalidTextFields
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
  const hasBlockingErrors: boolean =
    fieldChecks.missing.length > 0 ||
    fieldChecks.invalid.length > 0 ||
    fieldChecks.invalidText.length > 0 ||
    !deadlineResult.valid; // wrongYear is not blocking under Rule C

  const statusHint: 'VALID' | 'INVALID' = hasBlockingErrors ? 'INVALID' : 'VALID';

  // ---------------------------------------------
  // 8) Return structured result
  // ---------------------------------------------
  return {
    normalizedRow,
    fieldChecks,
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