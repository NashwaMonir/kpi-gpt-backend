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
import { ErrorCodes, addErrorCode } from './errorCodes';

export interface MetricResolutionResult {
  output: string;
  quality: string;
  improvement: string;

  needsReview: boolean;
  reviewText: string;     // e.g. "Metrics auto-suggested (Output / Quality / Improvement)."
}

export function resolveMetrics(
  row: KpiRowIn,
  errorCodes: string[]
): MetricResolutionResult {
  const roleLower = row.team_role?.toLowerCase() ?? '';
  const defaults = pickRoleDefaults(roleLower);

  const safeOutput = (row.output_metric ?? '').trim();
  const safeQuality = (row.quality_metric ?? '').trim();
  const safeImprovement = (row.improvement_metric ?? '').trim();

  let output = safeOutput;
  let quality = safeQuality;
  let improvement = safeImprovement;

  const missing: string[] = [];

  // -------------------------
  // 1. Detect missing metrics
  // -------------------------
  if (!safeOutput) {
    output = defaults.output;
    missing.push('Output');
  }

  if (!safeQuality) {
    quality = defaults.quality;
    missing.push('Quality');
  }

  if (!safeImprovement) {
    improvement = defaults.improvement;
    missing.push('Improvement');
  }

  // Normalize all resolved metrics to trimmed strings to guard future packs
  output = output.trim();
  quality = quality.trim();
  improvement = improvement.trim();

  // -------------------------
  // 2. If none missing → fully valid
  // -------------------------
  if (missing.length === 0) {
    return {
      output,
      quality,
      improvement,
      needsReview: false,
      reviewText: ''
    };
  }

  // -------------------------
  // 3. Some / All missing → NEEDS_REVIEW
  // -------------------------
  if (missing.length === 3) {
    // All metrics missing → E501
    addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_ALL);

    return {
      output,
      quality,
      improvement,
      needsReview: true,
      reviewText: 'Metrics auto-suggested (Output / Quality / Improvement).'
    };
  }

  // 1 or 2 missing → E502
  addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL);

  return {
    output,
    quality,
    improvement,
    needsReview: true,
    reviewText: `Metrics auto-suggested for: ${missing.join(' / ')}.`
  };
}

/**
 * Finds default metrics based on base team role.
 * If role is unrecognized → return generic defaults.
 */
export function pickRoleDefaults(roleLower: string) {
  if (roleLower.includes('content')) return ROLE_DEFAULT_METRICS.content;
  if (roleLower.includes('design')) return ROLE_DEFAULT_METRICS.design;
  if (roleLower.includes('development')) return ROLE_DEFAULT_METRICS.development;
  return ROLE_DEFAULT_METRICS.generic;
}