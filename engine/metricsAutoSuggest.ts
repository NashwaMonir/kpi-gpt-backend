// engine/metricsAutoSuggest.ts
// Metric auto-suggest logic for KPI Engine v10.8 (Option C-FULL)
//
// Rules:
//  - If ALL 3 metrics missing  → auto-suggest defaults + E501 (NEEDS_REVIEW)
//  - If SOME metrics missing   → auto-suggest defaults + E502 (NEEDS_REVIEW)
//  - If NONE missing           → no auto-suggest, no E501/E502
//
// v10.8+variant-seed:
//  - Primary source = role_metric_matrix via metricMatrixResolver.resolveMatrixMetrics(row, variationSeed)
//  - Fallback       = ROLE_DEFAULT_METRICS (role-family defaults)

import type { KpiRowIn } from './types';

import { ErrorCodes, addErrorCode, type ErrorCode } from './errorCodes';
import {
  resolveMatrixKey,
  resolveMatrixMetrics,
  type MatrixKey
} from './metricMatrixResolver';
import { normalizeTeamRole, normalizeTaskType } from './normalizeFields';

import role_default_metrics from '../data/role_default_metrics.json';

type RoleDefaultKey =
  | 'content'
  | 'content_lead'
  | 'design'
  | 'design_lead'
  | 'development'
  | 'development_lead'
  | 'generic';

type RoleDefaultMetrics = {
  output: string;
  quality: string;
  improvement: string;
};

function stripBaselinePhrases(text: string): string {
  let s = String(text || "").trim();
  if (!s) return "";

  // Remove embedded baseline language so objectiveEngine owns baseline clauses.
  s = s
    .replace(/\bmeasured\s+against\b[^,.]*?(?=[,.]|$)/gi, "") // remove "measured against …"
    .replace(/\(\s*based\s+on\b[^)]*\)/gi, "")                // remove "(based on …)"
    .replace(/\b(measured\s+against|based\s+on)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim();

  return s;
}

function sanitizeSuggestedMetric(
  kind: "output" | "quality" | "improvement",
  text: string
): string {
  let s = stripBaselinePhrases(text);
  if (!s) return "";

  // OUTPUT must not start with "Ensure" (prevents "to achieve Ensure …" grammar).
  if (kind === "output" && /^ensure\b/i.test(s)) {
    s = s.replace(/^ensure\b\s*/i, "Deliver ");
  }

  // IMPROVEMENT should be baseline-neutral (optionally allow "vs baseline").
  // Do not inject any baseline clause here.
  s = s.replace(/\bvs\s+baseline\b\s*vs\s+baseline\b/gi, "vs baseline");

  return s.trim();
}

const ROLE_DEFAULT_METRICS = role_default_metrics as Record<RoleDefaultKey, RoleDefaultMetrics>;
export interface MetricResolutionResult {
  output_metric: string | null;
  quality_metric: string | null;
  improvement_metric: string | null;
  used_default_metrics: boolean;
  /**
   * Logical family-level key used when resolving metrics from the matrix.
   * This is optional and mainly for diagnostics / analytics.
   */
  default_source?: MatrixKey;
}

/**
 * Resolve metrics for a normalized row:
 *  - If all present → no changes, used_default_metrics = false.
 *  - If some/all missing → fill from matrix / role defaults + E501/E502.
 *
 * Inputs:
 *  - row           : Domain-normalized KpiRowIn
 *  - variationSeed : Deterministic seed for matrix rotation (per-row)
 *  - errorCodes    : Shared error-code bucket (mutated in-place)
 */
export function resolveMetrics(
  row: KpiRowIn,
  variationSeed: number,
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

  // 1) Detect missing metrics
  const missing: string[] = [];
  if (!currentOutput) missing.push('Output');
  if (!currentQuality) missing.push('Quality');
  if (!currentImprovement) missing.push('Improvement');

  // 2) Nothing missing → no auto-suggest, no E501/E502
  if (missing.length === 0) {
    return {
      output_metric: output,
      quality_metric: quality,
      improvement_metric: improvement,
      used_default_metrics: false
    };
  }

  // 3.1 Canonicalize role/type for matrix resolution (defensive).
  // IMPORTANT: We do NOT compute any new seed here. We only ensure the resolver
  // sees canonical labels, even if a caller accidentally passed raw values.
  const roleNorm = normalizeTeamRole(row.team_role);
  const typeNorm = normalizeTaskType(row.task_type);

  const rowForMatrix: KpiRowIn = {
    ...row,
    team_role: roleNorm.isAllowed && roleNorm.normalized ? roleNorm.normalized : (row.team_role ?? ''),
    task_type: typeNorm.isAllowed && typeNorm.normalized ? typeNorm.normalized : (row.task_type ?? '')
  };

  // 3.2 Family-level key kept only for diagnostics / default_source
  const key = resolveMatrixKey(rowForMatrix.team_role, rowForMatrix.task_type);

  // 3.3 Canonical matrix resolver using passed seeded rotation only
  const matrixDefaults = resolveMatrixMetrics(rowForMatrix, variationSeed);

  if (!output) {
    output = matrixDefaults ? matrixDefaults.output : defaults.output;
  }
  if (!quality) {
    quality = matrixDefaults ? matrixDefaults.quality : defaults.quality;
  }
  if (!improvement) {
    improvement = matrixDefaults
      ? matrixDefaults.improvement
      : defaults.improvement;
  }

  // Normalize all resolved metrics
  output = output.trim();
  quality = quality.trim();
  improvement = improvement.trim();

  // v10.8/v11 contract hardening:
  // - Auto-suggested metrics must be baseline-neutral (objectiveEngine owns baseline clauses)
  // - Output metrics must not start with "Ensure" (prevents "to achieve Ensure …" grammar)
  output = sanitizeSuggestedMetric('output', output);
  quality = sanitizeSuggestedMetric('quality', quality);
  improvement = sanitizeSuggestedMetric('improvement', improvement);

  // 4) Metrics error codes (E501 / E502)
  if (missing.length === 3) {
    // All metrics missing → E501
    addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_ALL);
  } else {
    // 1 or 2 missing → E502
    addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL);
  }

  return {
    output_metric: output,
    quality_metric: quality,
    improvement_metric: improvement,
    used_default_metrics: true,
    default_source: key || undefined
  };
}

/**
 * Finds default metrics based on normalized team_role.
 *
 * Rules (v10.7.5, v10.8-ready):
 *  - Detect base family: content | design | development (prefix match).
 *  - Detect "lead" anywhere in the role string.
 *  - Map to ROLE_DEFAULT_METRICS:
 *      content           → ROLE_DEFAULT_METRICS.content
 *      content lead      → ROLE_DEFAULT_METRICS.content_lead
 *      design            → ROLE_DEFAULT_METRICS.design
 *      design lead       → ROLE_DEFAULT_METRICS.design_lead
 *      development       → ROLE_DEFAULT_METRICS.development
 *      development lead  → ROLE_DEFAULT_METRICS.development_lead
 *  - Anything else       → ROLE_DEFAULT_METRICS.generic
 */
export function pickRoleDefaults(
  roleLowerRaw: string
): (typeof ROLE_DEFAULT_METRICS)[keyof typeof ROLE_DEFAULT_METRICS] {
  const base = (roleLowerRaw ?? '').trim().toLowerCase();
  if (!base) {
    return ROLE_DEFAULT_METRICS.generic;
  }

  const isLead = /\blead\b/.test(base);

  if (base.startsWith('content')) {
    return isLead ? ROLE_DEFAULT_METRICS.content_lead : ROLE_DEFAULT_METRICS.content;
  }

  if (base.startsWith('design')) {
    return isLead ? ROLE_DEFAULT_METRICS.design_lead : ROLE_DEFAULT_METRICS.design;
  }

  if (base.startsWith('development')) {
    return isLead
      ? ROLE_DEFAULT_METRICS.development_lead
      : ROLE_DEFAULT_METRICS.development;
  }

  // Fallback to generic metrics when role family is unknown
  return ROLE_DEFAULT_METRICS.generic;
}