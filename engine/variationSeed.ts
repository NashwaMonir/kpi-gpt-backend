// engine/variationSeed.ts
import type { KpiRowIn } from './types';

function normalize(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

function fnv1a32(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * ONE canonical seed for the row.
 * IMPORTANT: exclude company to prevent bulk vs single drift in matrix selection.
 * (Objectives can still use company text as content, but not to drive randomization.)
 */
export function computeVariationSeed(row: KpiRowIn): number {
  const role = normalize(row.team_role);
  const type = normalize(row.task_type);
  const rowId = String((row as any).row_id ?? '').trim();

  // Company intentionally excluded.
  return fnv1a32(`${role}|${type}|${rowId}`);
}

/**
 * Deterministic derived seed from the canonical variation_seed.
 * No caller is allowed to invent new seeds.
 */
export function deriveSeed(variationSeed: number, scope: string): number {
  return fnv1a32(`${variationSeed}|${scope}`);
}

/**
 * Matrix rotation seed.
 * MUST be company‑independent to guarantee bulk vs single parity.
 */
export function getMatrixSeed(variationSeed: number): number {
  return deriveSeed(variationSeed, 'matrix');
}

/**
 * Objective phrasing seed.
 * MAY include company context via scope if needed, but must always
 * derive from the canonical variationSeed.
 */
export function getObjectiveSeed(
  variationSeed: number,
  company?: string | null
): number {
  const scope = company
    ? `objective|${company.toString().trim().toLowerCase()}`
    : 'objective';
  return deriveSeed(variationSeed, scope);
}