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
  ALLOWED_TEAM_ROLE_PREFIXES,
  type TeamRoleFamily
} from './constants';

// ---- Runtime imports ----
import { ErrorCodes, addErrorCode } from './errorCodes';

// ------------------------------------------------------------
// Core string helper
// ------------------------------------------------------------

/**
 * Safely convert any unknown value to a trimmed string.
 * Never returns null/undefined; always returns a string (possibly empty).
 */
export function toSafeTrimmedString(value: unknown): string {
  return (value ?? '').toString().trim();
}

// ------------------------------------------------------------
// Task Type normalization
// ------------------------------------------------------------

export interface NormalizedTaskTypeResult {
  normalized: string;   // canonical label or original if invalid
  isAllowed: boolean;   // true if in ALLOWED_TASK_TYPES
}

/**
 * Normalize task_type to canonical form using ALLOWED_TASK_TYPES.
 * Matching is case-insensitive.
 *
 * Returns:
 *  - normalized: canonical task type if allowed, or original trimmed input
 *  - isAllowed: true if the normalized value is one of the allowed types
 */
export function normalizeTaskType(raw: unknown): NormalizedTaskTypeResult {
  const safe = toSafeTrimmedString(raw);
  if (!safe) {
    return { normalized: '', isAllowed: false };
  }
  // canonical lower string for comparison:
  //  - collapse multiple spaces
  //  - treat -, _ like spaces
   const canonical = safe
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const idx = ALLOWED_TASK_TYPES_LOWER.indexOf(canonical);

  if (idx === -1) {
    // Not one of the allowed values; keep original text
    return { normalized: safe, isAllowed: false };
  }

  return {
    normalized: ALLOWED_TASK_TYPES[idx],
    isAllowed: true
  };
}

// ------------------------------------------------------------
// Team Role normalization
// ------------------------------------------------------------

export interface NormalizedTeamRoleResult {
  normalized: string;         // canonical label or original if invalid
  isAllowed: boolean;         // true if in ALLOWED_TEAM_ROLES
  family: TeamRoleFamily | null; // 'content' | 'design' | 'development' | null
  isLead: boolean;            // true if "... Lead" role
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
export function normalizeTeamRole(raw: unknown): NormalizedTeamRoleResult {
  const safe = toSafeTrimmedString(raw);
  if (!safe) {
     return {
      normalized: '',
      isAllowed: false,
      family: null,
      isLead: false
    };
  }
 // Canonicalized lowercase used for all matching
  const canonical = safe
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // ---------------------------------------------
  // 1) Exact allowed-role match
  // ---------------------------------------------
  const idx = ALLOWED_TEAM_ROLES_LOWER.indexOf(canonical);

  let normalized: string;
  let isAllowed = false;

  if (idx === -1) {
    normalized = safe;
  } else {
    normalized = ALLOWED_TEAM_ROLES[idx];
    isAllowed = true;
  }

// ---------------------------------------------
  // 2) Derive family using prefix (before dash)
  //    Works for inputs like:
  //    "Content – Project", "Design - UX", "Development–API"
  // ---------------------------------------------
  const baseLower = canonical.split(/[–-]/)[0].trim();


  let family: TeamRoleFamily | null = null;
  for (const prefix of ALLOWED_TEAM_ROLE_PREFIXES) {
    if (baseLower.startsWith(prefix)) {
      family = prefix;
      break;
    }
  }
// ---------------------------------------------
  // 3) Detect "lead" inside role
  // ---------------------------------------------
  const isLead = canonical.includes('lead');

  return {
    normalized,
    isAllowed,
    family,
    isLead
  };
}

// ------------------------------------------------------------
// Mode normalization
// ------------------------------------------------------------

/**
 * Normalize mode to one of: 'simple' | 'complex' | 'both'
 * - Empty → 'both' (no error)
 * - Valid value → itself
 * - Invalid → fallback to 'both' and record INVALID_MODE_VALUE (E306)
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