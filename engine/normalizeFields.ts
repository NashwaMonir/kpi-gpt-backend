// engine/normalizeFields.ts
// Field normalization helpers for KPI Engine v10.7.5 (Option C-FULL)

// ---- Types (imported first) ----
import type { ErrorCode } from './errorCodes';
import type { Mode } from './types';

// ---- Constants ----
import {
  ALLOWED_TASK_TYPES,
  ALLOWED_TASK_TYPES_LOWER,
  ALLOWED_TEAM_ROLES,
  ALLOWED_TEAM_ROLES_LOWER
} from './constants';

// ---- Runtime imports ----
import { ErrorCodes, addErrorCode } from './errorCodes';

/**
 * Safely coerce any possibly-null value to a trimmed string.
 */
export function toSafeTrimmedString(value: unknown): string {
  return (value ?? '').toString().trim();
}

/**
 * Normalize task_type to canonical form using ALLOWED_TASK_TYPES.
 * Matching is case-insensitive.
 *
 * Returns:
 *  - normalized: canonical task type if allowed, or original trimmed input
 *  - isAllowed: true if the normalized value is one of the allowed types
 */
export function normalizeTaskType(raw: unknown): { normalized: string; isAllowed: boolean } {
  const safe = toSafeTrimmedString(raw);
  if (!safe) {
    return { normalized: '', isAllowed: false };
  }

   const canonical = safe
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const idx = ALLOWED_TASK_TYPES_LOWER.indexOf(canonical);

  if (idx === -1) {
    return { normalized: safe, isAllowed: false };
  }

  return {
    normalized: ALLOWED_TASK_TYPES[idx],
    isAllowed: true
  };
}

/**
 * Normalize team_role to canonical form using ALLOWED_TEAM_ROLES.
 * - Handles patterns like "Design – Project" by splitting on "–" and using the left part.
 * - Matching is case-insensitive.
 *
 * Returns:
 *  - normalized: canonical team role if allowed, or original trimmed input
 *  - isAllowed: true if the normalized value is one of the allowed roles
 */
export function normalizeTeamRole(raw: unknown): { normalized: string; isAllowed: boolean } {
  const safe = toSafeTrimmedString(raw);
  if (!safe) {
    return { normalized: '', isAllowed: false };
  }

  // Extract base role before any "–" separator (e.g., "Design – Project")
  const base = safe.split(/[–-]/)[0].trim();
  const lowerBase = base.toLowerCase();
  const idx = ALLOWED_TEAM_ROLES_LOWER.indexOf(lowerBase);

  if (idx === -1) {
    return { normalized: base || safe, isAllowed: false };
  }

  return {
    normalized: ALLOWED_TEAM_ROLES[idx],
    isAllowed: true
  };
}

/**
 * Normalize mode to 'simple' | 'complex' | 'both', with fallback and error code when invalid.
 *
 * Behavior:
 *  - Empty / undefined → 'both' (default)
 *  - 'simple' | 'complex' | 'both' (case-insensitive) → same canonical value
 *  - Any other value → treated as invalid, fallback to 'both', and error code E306 added.
 */
export function normalizeMode(
  rawMode: unknown,
  errorCodes: ErrorCode[]   // <-- STRICT TYPING HERE
): { mode: Mode; wasInvalid: boolean } {
  const safe = toSafeTrimmedString(rawMode).toLowerCase();
  const validModes: Mode[] = ['simple', 'complex', 'both'];

  if (!safe) {
    return { mode: 'both', wasInvalid: false };
  }

  if (validModes.includes(safe as Mode)) {
    return { mode: safe as Mode, wasInvalid: false };
  }

  // Invalid → fallback to 'both' + record error code (E306)
  addErrorCode(errorCodes, ErrorCodes.INVALID_MODE_VALUE);
  return { mode: 'both', wasInvalid: true };
}
  