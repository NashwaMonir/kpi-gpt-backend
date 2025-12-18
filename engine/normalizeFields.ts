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
function resolveCanonicalTeamRoleFromFamily(
  family: TeamRoleFamily,
  isLead: boolean
): string | null {
  const targetLower = isLead ? `${family} lead` : family;
  const idx = ALLOWED_TEAM_ROLES_LOWER.indexOf(targetLower);
  if (idx === -1) return null;
  return ALLOWED_TEAM_ROLES[idx];
}
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
  const isLead = /\blead\b/.test(canonical);

  if (!isAllowed && family) {
    const canonicalFromFamily = resolveCanonicalTeamRoleFromFamily(family, isLead);
    if (canonicalFromFamily) {
      normalized = canonicalFromFamily;
      isAllowed = true;
    }
  }

  return {
    normalized,
    isAllowed,
    family,
    isLead
  };
}

// ------------------------------------------------------------
// Deadline normalization (v10.8 canonical)
// ------------------------------------------------------------

export interface NormalizedDeadlineResult {
  normalized: string | null; // YYYY-MM-DD
  isValid: boolean;
}

/**
 * Normalize deadline into YYYY-MM-DD (date-only ISO).
 *
 * Accepted inputs:
 * - YYYY-MM-DD
 * - DD/MM/YYYY
 * - DD-MM-YYYY
 * - ISO strings with time (time stripped)
 *
 * Locale rule:
 * - Slash or dash with 3 parts = DD/MM/YYYY (Egypt + Sweden rule)
 */
export function normalizeDeadline(raw: unknown): NormalizedDeadlineResult {
  const safe = toSafeTrimmedString(raw);
  if (!safe) return { normalized: null, isValid: false };

  // YYYY-MM-DD
  const iso = safe.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [_, y, m, d] = iso;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const ok =
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() === Number(m) - 1 &&
      dt.getUTCDate() === Number(d);
    return { normalized: ok ? `${y}-${m}-${d}` : null, isValid: ok };
  }

  // ISO with time → strip to date, then validate
  if (/^\d{4}-\d{2}-\d{2}T/.test(safe)) {
    return normalizeDeadline(safe.slice(0, 10));
  }

  // DD/MM/YYYY or DD-MM-YYYY (Egypt + Sweden rule)
  const m = safe.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];

    const dt = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    const ok =
      dt.getUTCFullYear() === Number(yyyy) &&
      dt.getUTCMonth() === Number(mm) - 1 &&
      dt.getUTCDate() === Number(dd);

    return { normalized: ok ? `${yyyy}-${mm}-${dd}` : null, isValid: ok };
  }

  return { normalized: null, isValid: false };
}

// ------------------------------------------------------------
// Mode normalization
// ------------------------------------------------------------

/**
 * Normalize mode to one of: 'simple' | 'complex' | 'both'.
 *
 * IMPORTANT:
 * - Mode is treated as a *user hint only*.
 * - The objective engine (objectiveEngine.ts) decides the effective mode
 *   based on lead role, metrics_auto_suggested, strategic benefit, and
 *   missing-metric safety rules.
 *
 * Behavior:
 * - Empty → 'both' (no error; means "no preference").
 * - Valid value → itself (still only a hint).
 * - Invalid → fallback to 'both' and record INVALID_MODE_VALUE (E306).
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