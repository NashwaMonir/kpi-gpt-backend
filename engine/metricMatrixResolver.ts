// engine/metricMatrixResolver.ts
// Resolve role/task → matrix metrics for KPI Engine v10.7.5
//
// This module is the single source of truth for looking up metric
// triples from role_metric_matrix.json using:
//   - normalization maps (role_mapping, task_type_mapping)
//   - deterministic seeded rotation per (role, task_type) bucket.
//
// It is used by metricsAutoSuggest.ts via:
//   - resolveMatrixKey(team_role, task_type)   → MatrixKey (family-level, optional)
//   - resolveMatrixMetrics(row, variationSeed) → MatrixMetricSet (concrete metrics)

import role_metric_matrix from '../data/role_metric_matrix.json';
import type { KpiRowIn } from './types';

// High-level role + task typing (used for diagnostics / defaults)
export type RoleFamily = 'content' | 'design' | 'development';
export type TaskTypeKey = 'project' | 'change_request' | 'consultation';

export interface MatrixKey {
  role_family: RoleFamily;
  task_type: TaskTypeKey;
}

/**
 * Simple logical metric triple (family + task based).
 * Kept for potential family-level usage elsewhere.
 */
export interface MatrixMetrics {
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;
}

/**
 * Concrete resolved matrix entry coming from role_metric_matrix.json
 * after applying normalization + seeded selection.
 */
export interface MatrixMetricSet {
  output: string;
  quality: string;
  improvement: string;
  baseLine?: string | null;
  entryId?: string;
}

interface MatrixConfig {
  normalization: {
    role_mapping: Record<string, string>;
    task_type_mapping: Record<string, string>;
  };
  entries: Array<{
    id: string;
    normalized_role: string;
    task_type: string;
    output_metric: string;
    quality_metric: string;
    improvement_metric: string;
    base_line?: string | null;
  }>;
}

// Cast JSON into typed config
const MATRIX = role_metric_matrix as unknown as MatrixConfig;

type BucketKey = string;

/**
 * Precompute buckets of matrix entries keyed by (normalized_role, task_type)
 * so we can later pick a seeded variant per row.
 */
const buckets: Map<BucketKey, MatrixConfig['entries']> = new Map();

for (const entry of MATRIX.entries) {
  const key: BucketKey = `${entry.normalized_role}|||${entry.task_type}`;
  const existing = buckets.get(key);
  if (existing) existing.push(entry);
  else buckets.set(key, [entry]);
}

function normalizeKey(
  map: Record<string, string>,
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  return map[lower] ?? null;
}

function seededIndex(seed: number, salt: string, size: number): number {
  if (size <= 0) return 0;
  let hash = 2166136261;
  const key = seed.toString() + '|' + salt;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

/**
 * Normalize raw team_role text down to a high-level family.
 * This is independent from the JSON normalization mapping and can be
 * used for defaults / analytics.
 */
export function detectRoleFamily(
  teamRoleRaw: string | null | undefined
): RoleFamily | null {
  const raw = (teamRoleRaw || '').trim().toLowerCase();
  if (!raw) return null;

  if (raw.startsWith('content')) return 'content';
  if (raw.startsWith('design')) return 'design';
  if (raw.startsWith('development')) return 'development';

  return null;
}

/**
 * Normalize raw task_type text down to high-level task keys.
 */
export function detectTaskType(
  taskTypeRaw: string | null | undefined
): TaskTypeKey | null {
  const raw = (taskTypeRaw || '').trim().toLowerCase();
  if (!raw) return null;

  if (raw === 'project') return 'project';
  if (raw === 'change_request' || raw === 'change request') return 'change_request';
  if (raw === 'consultation') return 'consultation';

  return null;
}

/**
 * Logical family-level matrix key, if you need it in other parts of the engine.
 * Used today by metricsAutoSuggest for default_source diagnostics.
 */
export function resolveMatrixKey(
  teamRoleRaw: string | null | undefined,
  taskTypeRaw: string | null | undefined
): MatrixKey | null {
  const role_family = detectRoleFamily(teamRoleRaw);
  const task_type = detectTaskType(taskTypeRaw);
  if (!role_family || !task_type) return null;
  return { role_family, task_type };
}

/**
 * Canonical resolver used by metricsAutoSuggest:
 * - Uses MATRIX.normalization mappings to normalize team_role and task_type.
 * - Uses variationSeed to select a deterministic variant from the bucket.
 * - Returns a MatrixMetricSet describing the chosen entry.
 */
export function resolveMatrixMetrics(
  row: KpiRowIn,
  variationSeed: number
): MatrixMetricSet | null {
  const normRole = normalizeKey(
    MATRIX.normalization.role_mapping,
    row.team_role ?? null
  );
  const normTask = normalizeKey(
    MATRIX.normalization.task_type_mapping,
    row.task_type ?? null
  );

  if (!normRole || !normTask) return null;

  const bucketKey: BucketKey = `${normRole}|||${normTask}`;
  const items = buckets.get(bucketKey);
  if (!items || items.length === 0) return null;

  const idx = seededIndex(variationSeed, `matrix|${bucketKey}`, items.length);
  const chosen = items[idx];

  return {
    output: chosen.output_metric,
    quality: chosen.quality_metric,
    improvement: chosen.improvement_metric,
    baseLine: chosen.base_line ?? null,
    entryId: chosen.id
  };
}