// engine/metricMatrixResolver.ts
// Resolve role/task → matrix metrics for KPI Engine v10.7.5

import ROLE_DEFAULT_METRICS from '../data/roleMetricMatrix.json';

export type RoleFamily = 'content' | 'design' | 'development';
export type TaskTypeKey = 'project' | 'change_request' | 'consultation';

export interface MatrixKey {
  role_family: RoleFamily;
  task_type: TaskTypeKey;
}

export interface MatrixMetrics {
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;
}

/**
 * Normalize raw team_role text (e.g. "Content – Project", "Content lead")
 * down to the base family used in ROLE_DEFAULT_METRICS.
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
 * Normalize raw task_type text (e.g. "Project", "project", "Change Request")
 * down to the keys used in ROLE_DEFAULT_METRICS.
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
 * Get the logical matrix key (role_family + task_type) for a row.
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
 * Retrieve the metrics for a specific matrix key, or null if not defined.
 */
export function resolveMatrixMetrics(key: MatrixKey): MatrixMetrics | null {
  const familyEntry = (ROLE_DEFAULT_METRICS as any)[key.role_family] || {};
  const metrics = familyEntry[key.task_type] as MatrixMetrics | undefined;
  return metrics || null;
}