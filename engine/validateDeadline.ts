// engine/validateDeadline.ts
// Flexible multi-format deadline parsing for KPI Engine v10.7.5 (Option C-FULL)

import {
  DEADLINE_YYYY_MM_DD,
  DEADLINE_YYYY_MM_DD_SLASH,
  DEADLINE_YYYY_MM_DD_DOT,
  DEADLINE_YYYY_MM_DD_SPACE,
  DEADLINE_DD_MM_YYYY_SLASH,
  DEADLINE_DD_MM_YYYY_DASH,
  DEADLINE_DD_MM_YYYY_DOT,
  DEADLINE_YYYY_TEXT_MONTH_DD,
  DEADLINE_YYYY_TEXT_MONTH_DD_SPACE,
  DEADLINE_DD_TEXT_MONTH_YYYY_DASH,
  DEADLINE_DD_TEXT_MONTH_YYYY_SPACE,
  DEADLINE_TEXT_MONTH_DD_YYYY_SPACE
} from './regex';

import { getCurrentEngineYear } from './constants';

// Types first
import type { DeadlineParseResult } from './types';
import type { ErrorCode } from './errorCodes';

// Runtime error-code helpers
import { ErrorCodes, addErrorCode } from './errorCodes';

/**
 * Main entry point for deadline validation.
 *
 * Supports:
 *  - YYYY-MM-DD
 *  - YYYY/MM/DD
 *  - YYYY.MM.DD
 *  - DD/MM/YYYY
 *  - DD-MM-YYYY
 *  - DD.MM.YYYY
 *  - YYYY-MMM-DD / YYYY-MMMM-DD
 *  - YYYY MMM DD
 *  - DD-MMM-YYYY / DD-MMMM-YYYY
 *  - DD MMM YYYY / DD MMMM YYYY
 *
 * Returns:
 *  valid: true  → valid format
 *  wrongYear: true  → valid format but year != current year
 *  date: JS Date (or null)
 */
function containsForbiddenChars(v: string): boolean {
  const lower = v.toLowerCase();

  return (
    /<script/i.test(v) ||
    /<\/script/i.test(v) ||
    /<img/i.test(v) ||
    /iframe/i.test(v) ||
    /\p{Emoji}/u.test(v) ||
    /`/.test(v) ||
    /\$\{/.test(v)
  );
}

export function validateDeadline(
  raw: unknown,
  errorCodes: ErrorCode[]
): DeadlineParseResult {
  const value = (raw ?? '').toString().trim();
 console.log('DEBUG deadline raw:', JSON.stringify(value));
  // Security: HTML, script, emoji should never be treated as valid dates.
// Treat as E305 textual deadlines.
if (containsForbiddenChars(value)) {
  console.log('DEBUG deadline hit containsForbiddenChars');
  addErrorCode(errorCodes, ErrorCodes.DEADLINE_TEXTUAL_DEADLINE);
  return { valid: false, wrongYear: false, date: null };
}

  // Missing → handled by domain validator (not here)
  if (!value) {
    return { valid: false, wrongYear: false, date: null };
  }

  // Textual / ambiguous deadlines (e.g., "Q1 2025", "FY25", "End of Q4", "before 2025 ends")
  // must be rejected with a dedicated textual-deadline error (E305) per 10_Deadline_Parsing_Spec.
  if (isTextualDeadline(value)) {
    console.log('DEBUG deadline classified as textual by isTextualDeadline');
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_TEXTUAL_DEADLINE);
    return { valid: false, wrongYear: false, date: null };
  }

  const parsed = tryParseAllFormats(value);

  if (!parsed || isNaN(parsed.getTime())) {
    console.log('DEBUG deadline classified as textual by isTextualDeadline');
    // Invalid date format → E304
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_INVALID_FORMAT);
    return { valid: false, wrongYear: false, date: null };
  }

  // Valid format — check year rule
  const year = parsed.getFullYear();
  const currentYear = getCurrentEngineYear();

  if (year !== currentYear) {
    // Wrong calendar year → E303
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_WRONG_YEAR);
    return { valid: true, wrongYear: true, date: parsed };
  }

  return { valid: true, wrongYear: false, date: parsed };
}

/**
 * Attempts all supported date formats.
 * Returns a Date object or null.
 */
function tryParseAllFormats(raw: string): Date | null {
  // 1. ISO 2025-10-01
  if (DEADLINE_YYYY_MM_DD.test(raw)) return new Date(raw);

  // 2. Slash 2025/1/5 or 2025/01/05
  if (DEADLINE_YYYY_MM_DD_SLASH.test(raw)) {
    const [yyyy, mm, dd] = raw.split('/');
    return new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
  }

  // 3. Dot 2025.1.5 or 2025.01.05
  if (DEADLINE_YYYY_MM_DD_DOT.test(raw)) {
    const [yyyy, mm, dd] = raw.split('.');
    return new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
  }

// 3b. Space 2025 05 01 (numeric)
if (DEADLINE_YYYY_MM_DD_SPACE.test(raw)) {
  const [yyyy, mm, dd] = raw.split(/\s+/);
  return new Date(`${yyyy}-${mm}-${dd}`);
}

  // 4. Egyptian DD/MM/YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_SLASH.test(raw)) {
    const [dd, mm, yyyy] = raw.split('/');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 5. European DD-MM-YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_DASH.test(raw)) {
    const [dd, mm, yyyy] = raw.split('-');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 6. European DD.MM.YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_DOT.test(raw)) {
    const [dd, mm, yyyy] = raw.split('.');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 7. Text month — year-first: 2025-Sep-30
  if (DEADLINE_YYYY_TEXT_MONTH_DD.test(raw)) {
    return new Date(raw);
  }

  // 8. Text month — year-first spaced: 2025 Sep 30
  if (DEADLINE_YYYY_TEXT_MONTH_DD_SPACE.test(raw)) {
    return new Date(raw);
  }

  // 9. Day-first text month: 30-Sep-2025 → rearrange
  if (DEADLINE_DD_TEXT_MONTH_YYYY_DASH.test(raw)) {
    const [dd, mon, yyyy] = raw.split('-');
    return new Date(`${yyyy}-${mon}-${dd}`);
  }

  // Day-first text month: 30 Sep 2025
if (DEADLINE_DD_TEXT_MONTH_YYYY_SPACE.test(raw)) {
  const [dd, mon, yyyy] = raw.split(/\s+/);
  return new Date(`${yyyy}-${mon}-${dd}`);
}

// Month-first text month: September 1 2025
if (DEADLINE_TEXT_MONTH_DD_YYYY_SPACE.test(raw)) {
  const [mon, dd, yyyy] = raw.split(/\s+/);
  return new Date(`${yyyy}-${mon}-${dd}`);
}
  return null;
}

/**
 * Detects textual / ambiguous deadlines that must be rejected as non-parsable
 * (e.g., "Q1 2025", "FY25", "End of Q4", "before 2025 ends", "year end").
 * These are not valid concrete dates and are mapped to E305 (textual deadline).
 */
function isTextualDeadline(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return false;

  // Quarter-based phrases: "Q1 2025", "Q4", "end of Q3"
  if (/\bq[1-4]\b/.test(v)) return true;
  if (/\bend of\s+q[1-4]\b/.test(v)) return true;

  // Fiscal year shorthand: "FY25", "FY 25"
  if (/\bfy\s*\d{2}\b/.test(v)) return true;

  // Year-end style phrases: "before 2025 ends", "before year end", "by year end", "year end"
  if (/\bbefore\s+\d{4}\s*ends\b/.test(v)) return true;
  if (/\b(before|by)\s+(year end|the end of the year)\b/.test(v)) return true;
  if (/\byear\s*end\b/.test(v)) return true;

  return false;
}