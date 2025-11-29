// engine/buildErrorMessage.ts
// Final error/comment/message builder for KPI Engine v10.7.5 (Option C-FULL)
//
// Responsibilities (per row):
//  - Convert domain validation + metrics auto-suggest into final status:
//      VALID | NEEDS_REVIEW | INVALID
//  - Construct comments and summary_reason (single-line, deterministic)
//  - Surface mode fallback and metrics auto-suggest messages
//  - Map error categories to human-readable text
//  - Ensure canonical ordering of error codes
//
// IMPORTANT:
//  - This layer performs ZERO validation.
//  - It only assembles the final output shape for the API.
//  - Validation and sanitization are handled in the engine validators.

import type { DomainValidationResult, KpiRowIn, Mode } from './types';
import type { MetricResolutionResult } from './metricsAutoSuggest';
import type { ErrorCode } from './errorCodes';
import { ErrorCodes, ERROR_COMMENTS } from './errorCodes';

export interface FinalAssemblyResult {
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  errorCodes: ErrorCode[];

  /**
   * Canonical row snapshots (for safe echoes / future v10.8 use)
   */
  input_row: KpiRowIn;      // sanitized input row used by the engine
  normalized_row: KpiRowIn; // same as input_row under v10.7.5, reserved for future transforms

  /**
   * Normalized control fields
   */
  mode: Mode;
  team_role_lower: string;
  task_type_lower: string;

  /**
   * Final metrics snapshot (already sanitized + resolved)
   */
  metrics: {
    output_metric: string;
    quality_metric: string;
    improvement_metric: string;
    needsReview: boolean;
  };
}

/**
 * Build the final row-level result:
 *  - Determine VALID / NEEDS_REVIEW / INVALID
 *  - Build comments (single-line, deterministic)
 *  - Build summary_reason (single dominant reason)
 *  - Ensure canonical ordering of error codes
 */
export function buildFinalMessage(
  domainResult: DomainValidationResult,
  metricsResult: MetricResolutionResult,
  errorCodes: ErrorCode[]
): FinalAssemblyResult {
  // ---------------------------------------------------------------------------
  // 0. Canonical error codes (sorted + deduplicated)
  // ---------------------------------------------------------------------------
  const canonicalErrorCodes: ErrorCode[] = Array.from(new Set(errorCodes)).sort();

  const {
    normalizedRow,
    fieldChecks,
    deadline,
    mode,
    modeWasInvalid,
    hasBlockingErrors,
    statusHint,
    safeOutput,
    safeQuality,
    safeImprovement,
    dangerousMetrics
  } = domainResult;

  const reviewText = (metricsResult.reviewText ?? '').trim();

  const teamRoleRaw = (normalizedRow.team_role ?? '').toString();
  const taskTypeRaw = (normalizedRow.task_type ?? '').toString();

  const teamRoleLower = teamRoleRaw.toLowerCase();
  const taskTypeLower = taskTypeRaw.toLowerCase();

  const metricsSnapshot = {
    output_metric: (metricsResult.output ?? safeOutput ?? '').toString(),
    quality_metric: (metricsResult.quality ?? safeQuality ?? '').toString(),
    improvement_metric: (metricsResult.improvement ?? safeImprovement ?? '').toString(),
    needsReview: !!metricsResult.needsReview
  };

  // ---------------------------------------------------------------------------
  // 1. Status derivation (domain first, then metrics/mode)
  //    - Domain INVALID always wins
  //    - Metrics / mode can only move VALID → NEEDS_REVIEW
  // ---------------------------------------------------------------------------
  let status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID' = 'VALID';

  if (statusHint === 'INVALID' || hasBlockingErrors) {
    status = 'INVALID';
  } else if (metricsResult.needsReview || modeWasInvalid) {
    status = 'NEEDS_REVIEW';
  }

  // ---------------------------------------------------------------------------
  // 2. Comments assembly (category-ordered)
  //
  // REQUIRED ORDER:
  //   1) Missing fields (E2xx)
  //   2) Invalid enum / value fields (E301–E302)
  //   3) Dangerous / low-signal text (E4xx)
  //   4) Deadline issues (E303–E305)
  //   5) Mode normalization (E306)
  //   6) Metrics messages
  //   7) Role fallback (optional)
  // ---------------------------------------------------------------------------
  const commentsParts: string[] = [];

  // Helper: push messages from ERROR_COMMENTS in code-order, avoiding duplicates.
  const pushFromCodes = (predicate: (code: ErrorCode) => boolean) => {
    for (const code of canonicalErrorCodes) {
      if (!predicate(code)) continue;
      const text = ERROR_COMMENTS[code];
      if (text && !commentsParts.includes(text)) {
        commentsParts.push(text);
      }
    }
  };

  // 2.1 Missing mandatory fields (E2xx) — we prefer fieldChecks to build precise message
  if (fieldChecks.missing.length > 0) {
    commentsParts.push(
      `Missing mandatory field(s): ${fieldChecks.missing.join(', ')}.`
    );
  } else {
    // Fallback to error-code-based messages if domain did not specify fields
    pushFromCodes(code => code.startsWith('E2'));
  }

  // 2.2 Invalid enum / value fields (E301, E302)
  if (fieldChecks.invalid.length > 0) {
    commentsParts.push(
      `Invalid value(s) for: ${fieldChecks.invalid.join(', ')}.`
    );
  } else {
    pushFromCodes(
      code =>
        code === ErrorCodes.INVALID_TASK_TYPE ||
        code === ErrorCodes.INVALID_TEAM_ROLE
    );
  }

  // 2.3 Dangerous / low-signal text (E4xx)
  // Combine domain-level invalidText fields (e.g. Company, Strategic Benefit)
  // with metric-level dangerousMetrics (Output, Quality, Improvement),
  // and emit a single canonical message.
  const invalidTextFields = fieldChecks.invalidText ?? [];
  const allDangerousFields = [
    ...invalidTextFields,
    ...(dangerousMetrics ?? [])
  ];
  const uniqueDangerousFields = Array.from(new Set(allDangerousFields));

  if (uniqueDangerousFields.length > 0) {
    commentsParts.push(
      `Invalid text format for: ${uniqueDangerousFields.join(', ')}.`
    );
  }
  // We deliberately do not fall back to ERROR_COMMENTS for E4xx,
  // to keep wording and field lists deterministic.

  // 2.4 Deadline issues (E303–E305)
  if (!deadline.valid) {
    if (canonicalErrorCodes.includes(ErrorCodes.DEADLINE_TEXTUAL_NONDATE)) {
      commentsParts.push('Deadline contains non-parsable or textual content.');
    } else if (canonicalErrorCodes.includes(ErrorCodes.DEADLINE_INVALID_FORMAT)) {
      commentsParts.push('Invalid deadline format.');
    }
  } else if (deadline.valid && deadline.wrongYear) {
    commentsParts.push('Deadline outside valid calendar year.');
  }

  // 2.5 Mode issue (E306) – informational
  if (modeWasInvalid || canonicalErrorCodes.includes(ErrorCodes.INVALID_MODE_VALUE)) {
    const text =
      ERROR_COMMENTS[ErrorCodes.INVALID_MODE_VALUE] ??
      "Mode fallback applied: defaulting to 'both'.";
    if (!commentsParts.includes(text)) {
      commentsParts.push(text);
    }
  }

  // 2.6 Metrics-related messages (only if status is not INVALID)
  if (status !== 'INVALID') {
    if (metricsResult.needsReview && reviewText) {
      commentsParts.push(reviewText);
    }
    // Optional: generic fallback note if generic role metrics were used
    if ((metricsResult as any).usedGenericFallback) {
      commentsParts.push('Metrics used generic role fallback.');
    }
  }

  // 2.7 Domain-level closing line for INVALID

  // Normalize spaces and join into single-line comments
  const comments = commentsParts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ---------------------------------------------------------------------------
  // 3. summary_reason hierarchy
  //
  //  - INVALID       → first domain-level message (first commentsParts entry)
  //  - NEEDS_REVIEW  → metrics review text if present, else mode fallback, else generic
  //  - VALID         → empty string (per v10.7.5 spec)
  // ---------------------------------------------------------------------------
 
  let summary_reason = '';

  if (status === 'INVALID') {
    // v10.7.5 UX: one clear, stable summary for all invalid rows.
    summary_reason = 'Objectives not generated due to validation errors.';

  } else if (status === 'NEEDS_REVIEW') {

    // v10.7.5 UX: one clear, consistent summary for NEEDS_REVIEW
    summary_reason = 'Objective metrics were auto-suggested based on the role matrix. Please review before approval.';

  } else {
    // VALID → no summary in v10.7.5
    summary_reason = '';
  }

  // ---------------------------------------------------------------------------
  // 4. VALID comments override (no domain or metrics issues)
  //    Spec: VALID rows must always return the fixed comment text.
  // ---------------------------------------------------------------------------
  if (status === 'VALID') {
    return {
      status,
      comments: 'All SMART criteria met.',
      summary_reason,
      errorCodes: canonicalErrorCodes,
      input_row: normalizedRow,
      normalized_row: normalizedRow,
      mode,
      team_role_lower: teamRoleLower,
      task_type_lower: taskTypeLower,
      metrics: metricsSnapshot
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Final assembly result for INVALID / NEEDS_REVIEW
  // ---------------------------------------------------------------------------
  return {
    status,
    comments,
    summary_reason,
    errorCodes: canonicalErrorCodes,
    input_row: normalizedRow,
    normalized_row: normalizedRow,
    mode,
    team_role_lower: teamRoleLower,
    task_type_lower: taskTypeLower,
    metrics: metricsSnapshot
  };
}