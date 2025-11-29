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
  ALLOWED_TEAM_ROLES_LOWER,
  ALLOWED_TEAM_ROLE_PREFIXES
} from './constants';

// ---- Runtime imports ----
import { ErrorCodes, addErrorCode } from './errorCodes';

/**
 * Safely coerce any possibly-null value to a trimmed string.
 */
export function toSafeTrimmedString(value: unknown): string {
  try {
    return (value ?? '').toString().trim();
  } catch {
    return String(value ?? '').trim();
  }
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
 *
 * Behavior:
 *  - First, try exact match (case-insensitive) against ALLOWED_TEAM_ROLES.
 *  - If no direct match, derive a "family" from the part before any dash (content/design/development)
 *    and a "lead" flag from the presence of the word "lead".
 *  - Map families into canonical roles: Content / Content Lead / Design / Design Lead / Development / Development Lead.
 */
export function normalizeTeamRole(raw: unknown): { normalized: string; isAllowed: boolean } {
  const safe = toSafeTrimmedString(raw);
  if (!safe) {
    return { normalized: '', isAllowed: false };
  }

  const lower = safe.toLowerCase();

  // 1) Direct match against allowed roles (case-insensitive)
  const directIdx = ALLOWED_TEAM_ROLES_LOWER.indexOf(lower);
  if (directIdx >= 0) {
    return {
      normalized: ALLOWED_TEAM_ROLES[directIdx],
      isAllowed: true
    };
  }

  // 2) Heuristic: derive family from the part before dash ("Content – Project" → "content")
  const baseLower = safe.split(/[–-]/)[0].trim().toLowerCase();

  let family: 'content' | 'design' | 'development' | null = null;
  for (const prefix of ALLOWED_TEAM_ROLE_PREFIXES) {
    if (baseLower.startsWith(prefix)) {
      family = prefix as 'content' | 'design' | 'development';
      break;
    }
  }

  if (!family) {
    // Unrecognized family → treat as invalid, return original
    return { normalized: safe, isAllowed: false };
  }

  const isLead = lower.includes('lead');

  const candidate =
    family === 'content'
      ? (isLead ? 'Content Lead' : 'Content')
      : family === 'design'
      ? (isLead ? 'Design Lead' : 'Design')
      : (isLead ? 'Development Lead' : 'Development');

  const candidateLower = candidate.toLowerCase();
  const allowedIdx = ALLOWED_TEAM_ROLES_LOWER.indexOf(candidateLower);

  if (allowedIdx === -1) {
    // Family understood but not part of ALLOWED_TEAM_ROLES → treat as invalid
    return { normalized: candidate, isAllowed: false };
  }

  return {
    normalized: ALLOWED_TEAM_ROLES[allowedIdx],
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
export function safeStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}