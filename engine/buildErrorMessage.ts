// engine/buildErrorMessage.ts
// Final error/comment/message builder for KPI Engine v10.7.5 (Option C-FULL)
//
// Responsibilities (per row):
//  - Convert domain validation results + metric auto-suggest results into
//    final status: VALID / NEEDS_REVIEW / INVALID
//  - Construct comments and summary_reason (single-line, deterministic)
//  - Include mode-fallback notes if relevant
//  - Apply canonical ordering of error parts
//
// This file contains ZERO validation logic.
// It only assembles the final output for the API.

import type { DomainValidationResult } from './types';
import type { MetricResolutionResult } from './metricsAutoSuggest';
import type { ErrorCode } from './errorCodes';
import { ErrorCodes } from './errorCodes';


export interface FinalAssemblyResult {
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  summary_reason: string;
  errorCodes: ErrorCode[];
}

/**
 * Build the final row-level result:
 *  - Determine VALID / NEEDS_REVIEW / INVALID
 *  - Build comments
 *  - Build summary_reason
 *  - Ensure canonical order and single-line output
 */
export function buildFinalMessage(
  domain: DomainValidationResult,
  metrics: MetricResolutionResult,
  errorCodes: ErrorCode[]
): FinalAssemblyResult {
  const canonicalErrorCodes: ErrorCode[] = Array.from(new Set(errorCodes)).sort();

  const { fieldChecks, deadline, modeWasInvalid, hasBlockingErrors } = domain;

  // ---------------------------------------
  // 1. INVALID conditions (blocking domain errors)
  // ---------------------------------------
  if (hasBlockingErrors) {
    const parts: string[] = [];

    // Missing mandatory fields
    if (fieldChecks.missing.length > 0) {
      parts.push(`Missing mandatory field(s): ${fieldChecks.missing.join(', ')}.`);
    }

    // Invalid enum fields (task type / team role)
    if (fieldChecks.invalid.length > 0) {
      parts.push(`Invalid value(s) for: ${fieldChecks.invalid.join(', ')}.`);
    }

    // Dangerous or low-semantic text fields
    if (fieldChecks.invalidText.length > 0) {
      parts.push(`Invalid text format for: ${fieldChecks.invalidText.join(', ')}.`);
    }

    // Deadline format vs textual deadline
    if (!deadline.valid) {
      if (canonicalErrorCodes.includes(ErrorCodes.DEADLINE_TEXTUAL_DEADLINE)) {
        parts.push('Deadline contains non-parsable or textual content.');
      } else {
        parts.push('Invalid deadline format.');
      }
    }

    // Deadline wrong year
    if (deadline.valid && deadline.wrongYear) {
      parts.push('Deadline outside valid calendar year.');
    }

    // Mandatory final line
    parts.push('Objectives not generated due to validation errors.');

    const reason = parts.join(' ').trim();

    // summary_reason must be the dominant first error category
    let summary_reason = '';
    if (fieldChecks.missing.length > 0) {
      summary_reason = `Missing mandatory field(s): ${fieldChecks.missing.join(', ')}.`;
    } else if (fieldChecks.invalid.length > 0) {
      summary_reason = `Invalid value(s) for: ${fieldChecks.invalid.join(', ')}.`;
    } else if (fieldChecks.invalidText.length > 0) {
      summary_reason = `Invalid text format for: ${fieldChecks.invalidText.join(', ')}.`;
    } else if (!deadline.valid) {
      if (canonicalErrorCodes.includes(ErrorCodes.DEADLINE_TEXTUAL_DEADLINE)) {
        summary_reason = 'Deadline contains non-parsable or textual content.';
      } else {
        summary_reason = 'Invalid deadline format.';
      }
    } else if (deadline.valid && deadline.wrongYear) {
      summary_reason = 'Deadline outside valid calendar year.';
    } else {
      summary_reason = 'Objectives not generated due to validation errors.';
    }

    return {
      status: 'INVALID',
      comments: reason,
      summary_reason,
      errorCodes: canonicalErrorCodes
    };
  }

  // ---------------------------------------
  // 2. NEEDS_REVIEW conditions
  // ---------------------------------------
  const needsReview =
    metrics.needsReview ||
    modeWasInvalid; // invalid mode fallback is informational but makes review needed

  if (needsReview) {
    let comment = '';

    // Mode fallback note (informational, appears before metrics in comments)
    if (modeWasInvalid) {
      comment += "Mode fallback applied: defaulting to 'both'. ";
    }

    // Metric auto-suggest comment
    if (metrics.needsReview) {
      comment += metrics.reviewText;
    }

    // Ensure final formatting is clean
    comment = comment.trim();

    // summary_reason rules:
    //  - If metrics.needsReview → metrics review text only
    //  - Else if only mode invalid → mode fallback note
    let summary_reason = '';
    if (metrics.needsReview && metrics.reviewText.trim()) {
      summary_reason = metrics.reviewText.trim();
    } else if (modeWasInvalid) {
      summary_reason = "Mode fallback applied: defaulting to 'both'.";
    }

    return {
      status: 'NEEDS_REVIEW',
      comments: comment,
      summary_reason,
      errorCodes: canonicalErrorCodes
    };
  }

  // ---------------------------------------
  // 3. VALID
  // ---------------------------------------
  const comments = 'All SMART criteria met.';

  return {
    status: 'VALID',
    comments,
    summary_reason: '',
    errorCodes: canonicalErrorCodes
  };
}