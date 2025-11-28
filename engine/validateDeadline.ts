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
 * Lightweight guard for obviously non-date / hostile content in deadline fields.
 *
 * NOTE:
 *  - This does not replace full dangerous-text validation on other fields.
 *  - It only prevents clearly unsafe patterns from ever being treated as dates
 *    and classifies them as textual/non-date (E305).
 */
function containsForbiddenChars(v: string): boolean {
  const lower = v.toLowerCase();

  return (
    /<script/i.test(v) ||
    /<\/script/i.test(v) ||
    /<img/i.test(v) ||
    /iframe/i.test(v) ||
    /javascript:/.test(lower) ||
    /`/.test(v) ||
    /\$\{/.test(v)
  );
}

/**
 * Detects textual / ambiguous deadlines that must be rejected as non-parsable
 * (e.g., "Q1 2025", "FY25", "End of Q4", "before 2025 ends", "year end").
 *
 * These are mapped to E305 (textual/non-date), never parsed as concrete dates.
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

/**
 * Helper: does the raw string match ANY of the supported concrete date formats?
 * This is a pure pattern-level check; semantic validation is done afterwards.
 */
function matchesAnySupportedFormat(raw: string): boolean {
  return (
    DEADLINE_YYYY_MM_DD.test(raw) ||
    DEADLINE_YYYY_MM_DD_SLASH.test(raw) ||
    DEADLINE_YYYY_MM_DD_DOT.test(raw) ||
    DEADLINE_YYYY_MM_DD_SPACE.test(raw) ||
    DEADLINE_DD_MM_YYYY_SLASH.test(raw) ||
    DEADLINE_DD_MM_YYYY_DASH.test(raw) ||
    DEADLINE_DD_MM_YYYY_DOT.test(raw) ||
    DEADLINE_YYYY_TEXT_MONTH_DD.test(raw) ||
    DEADLINE_YYYY_TEXT_MONTH_DD_SPACE.test(raw) ||
    DEADLINE_DD_TEXT_MONTH_YYYY_DASH.test(raw) ||
    DEADLINE_DD_TEXT_MONTH_YYYY_SPACE.test(raw) ||
    DEADLINE_TEXT_MONTH_DD_YYYY_SPACE.test(raw)
  );
}

/**
 * Main entry point for deadline validation.
 *
 * Supports:
 *  - YYYY-MM-DD
 *  - YYYY/MM/DD
 *  - YYYY.MM.DD
 *  - YYYY MM DD
 *  - DD/MM/YYYY
 *  - DD-MM-YYYY
 *  - DD.MM.YYYY
 *  - YYYY-MMM-DD / YYYY-MMMM-DD
 *  - YYYY MMM DD
 *  - DD-MMM-YYYY / DD-MMMM-YYYY
 *  - DD MMM YYYY / DD MMMM YYYY
 *  - MMM DD YYYY
 *
 * Returns:
 *  valid: true       → format was parsable into a concrete date
 *  wrongYear: true   → format valid, but year != current engine year (E303)
 *  date: JS Date (or null)
 */
export function validateDeadline(
  raw: unknown,
  errorCodes: ErrorCode[]
): DeadlineParseResult {
  const value = (raw ?? '').toString().trim();

  // Missing → handled by domain validator (not here)
  if (!value) {
    return { valid: false, wrongYear: false, date: null };
  }

  // Security: HTML/script/template markers must never be treated as dates.
  // Treat as textual/non-date E305.
  if (containsForbiddenChars(value)) {
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_TEXTUAL_NONDATE);
    return { valid: false, wrongYear: false, date: null };
  }

  // If the value clearly does NOT match any concrete date pattern,
  // classify as textual/non-date or generic invalid format.
  if (!matchesAnySupportedFormat(value)) {
    if (isTextualDeadline(value)) {
      // Textual / ambiguous date (e.g. "Q4 2025", "FY25") → E305
      addErrorCode(errorCodes, ErrorCodes.DEADLINE_TEXTUAL_NONDATE);
    } else {
      // Not one of the supported formats and not a known textual phrase → E304
      addErrorCode(errorCodes, ErrorCodes.DEADLINE_INVALID_FORMAT);
    }
    return { valid: false, wrongYear: false, date: null };
  }

  // At this point the string matches one of our supported formats.
  // Try to parse concretely.
  const parsed = tryParseAllFormats(value);

  if (!parsed || isNaN(parsed.getTime())) {
    // Pattern matched but date did not parse (e.g., 2025-13-40) → E304
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_INVALID_FORMAT);
    return { valid: false, wrongYear: false, date: null };
  }

  // Valid date — enforce engine-year rule
  const year = parsed.getFullYear();
  const currentYear = getCurrentEngineYear();

  if (year !== currentYear) {
    // Wrong calendar year → E303, but still a valid date
    addErrorCode(errorCodes, ErrorCodes.DEADLINE_WRONG_YEAR);
    return { valid: true, wrongYear: true, date: parsed };
  }

  return { valid: true, wrongYear: false, date: parsed };
}

/**
 * Attempts all supported date formats and returns a Date object or null.
 * Assumes the caller has already checked matchesAnySupportedFormat().
 */
function tryParseAllFormats(raw: string): Date | null {
  // 1. ISO 2025-10-01
  if (DEADLINE_YYYY_MM_DD.test(raw)) {
    return new Date(raw);
  }

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

  // 4. Space 2025 05 01 (numeric)
  if (DEADLINE_YYYY_MM_DD_SPACE.test(raw)) {
    const [yyyy, mm, dd] = raw.split(/\s+/);
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 5. Egyptian DD/MM/YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_SLASH.test(raw)) {
    const [dd, mm, yyyy] = raw.split('/');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 6. European DD-MM-YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_DASH.test(raw)) {
    const [dd, mm, yyyy] = raw.split('-');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 7. European DD.MM.YYYY → YYYY-MM-DD
  if (DEADLINE_DD_MM_YYYY_DOT.test(raw)) {
    const [dd, mm, yyyy] = raw.split('.');
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // 8. Text month — year-first: 2025-Sep-30 or 2025-September-30
  if (DEADLINE_YYYY_TEXT_MONTH_DD.test(raw)) {
    return new Date(raw);
  }

  // 9. Text month — year-first spaced: 2025 Sep 30 or 2025 September 30
  if (DEADLINE_YYYY_TEXT_MONTH_DD_SPACE.test(raw)) {
    return new Date(raw);
  }

  // 10. Day-first text month: 30-Sep-2025 → rearrange
  if (DEADLINE_DD_TEXT_MONTH_YYYY_DASH.test(raw)) {
    const [dd, mon, yyyy] = raw.split('-');
    return new Date(`${yyyy}-${mon}-${dd}`);
  }

  // 11. Day-first text month: 30 Sep 2025
  if (DEADLINE_DD_TEXT_MONTH_YYYY_SPACE.test(raw)) {
    const [dd, mon, yyyy] = raw.split(/\s+/);
    return new Date(`${yyyy}-${mon}-${dd}`);
  }

  // 12. Month-first text month: September 1 2025
  if (DEADLINE_TEXT_MONTH_DD_YYYY_SPACE.test(raw)) {
    const [mon, dd, yyyy] = raw.split(/\s+/);
    return new Date(`${yyyy}-${mon}-${dd}`);
  }

  return null;
}