// engine/metricsAutoSuggest.ts
// Metric auto-suggest logic for KPI Engine v10.7.5 (Option C-FULL)
//
// Rules:
//  - If ALL 3 metrics missing  → auto-suggest defaults + E501 (NEEDS_REVIEW)
//  - If SOME metrics missing   → auto-suggest defaults + E502 (NEEDS_REVIEW)
//  - If NONE missing           → VALID (no error codes added)
//
// v10.8: this module will be replaced by the role_metric_matrix engine.

import type { KpiRowIn } from './types';
import { ROLE_DEFAULT_METRICS } from './constants';
import { ErrorCodes, addErrorCode, type ErrorCode } from './errorCodes';

export interface MetricResolutionResult {
  output: string;
  quality: string;
  improvement: string;
  missingMetrics: string[];   // "Output", "Quality", "Improvement"
  needsReview: boolean;
  reviewText?: string;        // e.g. "Metrics auto-suggested (Output / Quality / Improvement)."
}

/**
 * Resolve metrics for a normalized row:
 *  - If all present → no changes, VALID from metrics view.
 *  - If some/all missing → fill from ROLE_DEFAULT_METRICS and mark NEEDS_REVIEW.
 */
export function resolveMetrics(
  row: KpiRowIn,
  errorCodes: ErrorCode[]
): MetricResolutionResult {
  const roleLower = row.team_role?.toLowerCase() ?? '';
  const defaults = pickRoleDefaults(roleLower);

  const currentOutput = (row.output_metric ?? '').trim();
  const currentQuality = (row.quality_metric ?? '').trim();
  const currentImprovement = (row.improvement_metric ?? '').trim();

  let output = currentOutput;
  let quality = currentQuality;
  let improvement = currentImprovement;

  const missing: string[] = [];
  if (!currentOutput) missing.push('Output');
  if (!currentQuality) missing.push('Quality');
  if (!currentImprovement) missing.push('Improvement');

  // Nothing missing → no auto-suggest, no E501/E502
  if (missing.length === 0) {
    return {
      output,
      quality,
      improvement,
      missingMetrics: [],
      needsReview: false,
      reviewText: ''
    };
  }

  // 1) Fill missing metrics from defaults
  if (!output) {
    output = defaults.output;
  }
  if (!quality) {
    quality = defaults.quality;
  }
  if (!improvement) {
    improvement = defaults.improvement;
  }

  // Normalize all resolved metrics
  output = output.trim();
  quality = quality.trim();
  improvement = improvement.trim();

  // 2) Mark NEEDS_REVIEW and add error codes
  let reviewText: string;
  if (missing.length === 3) {
    // All metrics missing → E501
    addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_ALL);
    reviewText = 'Metrics auto-suggested (Output / Quality / Improvement).';
  } else {
    // 1 or 2 missing → E502
    addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL);
    reviewText = `Metrics auto-suggested for: ${missing.join(', ')}.`;
  }

  return {
    output,
    quality,
    improvement,
    missingMetrics: missing,
    needsReview: true,
    reviewText
  };
}

/**
 * Finds default metrics based on normalized team_role.
 *
 * Rules (v10.7.5, v10.8-ready):
 *  - Detect base family: content | design | development (prefix match).
 *  - Detect "lead" anywhere in the role string.
 *  - Map to ROLE_DEFAULT_METRICS:
 *      content        → ROLE_DEFAULT_METRICS.content
 *      content lead   → ROLE_DEFAULT_METRICS.content_lead
 *      design         → ROLE_DEFAULT_METRICS.design
 *      design lead    → ROLE_DEFAULT_METRICS.design_lead
 *      development    → ROLE_DEFAULT_METRICS.development
 *      development lead → ROLE_DEFAULT_METRICS.development_lead
 *  - Anything else   → ROLE_DEFAULT_METRICS.generic
 */
export function pickRoleDefaults(roleLowerRaw: string): typeof ROLE_DEFAULT_METRICS[keyof typeof ROLE_DEFAULT_METRICS] {
  const base = (roleLowerRaw ?? '').trim().toLowerCase();
  if (!base) {
    return ROLE_DEFAULT_METRICS.generic;
  }

  const isLead = base.includes('lead');

  if (base.startsWith('content')) {
    return isLead ? ROLE_DEFAULT_METRICS.content_lead : ROLE_DEFAULT_METRICS.content;
  }

  if (base.startsWith('design')) {
    return isLead ? ROLE_DEFAULT_METRICS.design_lead : ROLE_DEFAULT_METRICS.design;
  }

  if (base.startsWith('development')) {
    return isLead ? ROLE_DEFAULT_METRICS.development_lead : ROLE_DEFAULT_METRICS.development;
  }

  // Fallback to generic metrics when role family is unknown
  return ROLE_DEFAULT_METRICS.generic;
}