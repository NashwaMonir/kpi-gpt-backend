// engine/variationSeed.ts
// Deterministic per-row variation seed (global driver for all variation).

import type { KpiRowIn } from './types';

function normalize(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

/**
 * Compute a stable 32-bit unsigned seed from canonical row features.
 * IMPORTANT:
 *  - Do NOT include full strategic_benefit text to avoid seed drift for typos.
 *  - Only use stable features: role, task_type, row_id, and optionally company.
 */
export function computeVariationSeed(row: KpiRowIn): number {
  const role = normalize(row.team_role);
  const type = normalize(row.task_type);
  const company = normalize(row.company ?? null);

  // Canonical key. You can drop company if you don’t want cross-company variation.
  const key = `${role}|${type}|${company}|${row.row_id}`;

  // FNV-1a 32-bit hash
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // unsigned
}