// engine/regex.ts
// Centralized regular expressions for KPI Engine v10.7.5 (Option C-FULL)

// ------------------------------------------------------------
// Deadline formats (string patterns only)
// ------------------------------------------------------------


// ISO: 2025-10-01
export const DEADLINE_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

// Slash: 2025/10/01
export const DEADLINE_YYYY_MM_DD_SLASH = /^\d{4}\/\d{1,2}\/\d{1,2}$/;   // allow 2025/1/5, 2025/01/05

// Dot: 2025.10.01
export const DEADLINE_YYYY_MM_DD_DOT   = /^\d{4}\.\d{1,2}\.\d{1,2}$/;   // 2025.1.5 or 2025.01.05

// New: space-separated
export const DEADLINE_YYYY_MM_DD_SPACE = /^\d{4}\s+\d{2}\s+\d{2}$/;     // 2025 05 01

// Egyptian / European numeric: 31/08/2025
export const DEADLINE_DD_MM_YYYY_SLASH = /^\d{1,2}\/\d{1,2}\/\d{4}$/; // 1/5/2025 → 01/05/2025 (1 May)

// European numeric dash: 31-08-2025
export const DEADLINE_DD_MM_YYYY_DASH = /^\d{2}-\d{2}-\d{4}$/;

// European numeric dot: 31.08.2025
export const DEADLINE_DD_MM_YYYY_DOT = /^\d{2}\.\d{2}\.\d{4}$/;

// Text month, year-first: 2025-Sep-30 or 2025-September-30
export const DEADLINE_YYYY_TEXT_MONTH_DD = /^\d{4}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*-\d{2}$/;

// Text month, space-separated year-first: 2025 Sep 30 or 2025 September 30
export const DEADLINE_YYYY_TEXT_MONTH_DD_SPACE = /^\d{4}\s+(Jan|Feb|...)[a-z]*\s+\d{1,2}$/;

// Text month, day-first dash: 30-Sep-2025 or 30-September-2025
export const DEADLINE_DD_TEXT_MONTH_YYYY_DASH  = /^\d{2}-(Jan|Feb|...)[a-z]*-\d{4}$/;

// Text month, day-first space: 30 Sep 2025 or 30 September 2025
export const DEADLINE_DD_TEXT_MONTH_YYYY_SPACE = /^\d{2}\s+(Jan|Feb|...)[a-z]*\s+\d{4}$/;

// New: Month-first, e.g. "September 1 2025"
export const DEADLINE_TEXT_MONTH_DD_YYYY_SPACE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+\d{4}$/;
  
// ------------------------------------------------------------
// Dangerous / invalid text detection
// ------------------------------------------------------------

// Simple HTML tag detector: <tag ...>
export const HTML_TAG_REGEX = /<[^>]+>/;

// Script / XSS markers: <script>, onerror=, javascript:
export const SCRIPT_XSS_REGEX = /(<script\b|onerror\s*=|javascript:)/i;

// Obvious SQL keywords, case-insensitive
export const SQL_KEYWORD_REGEX = /\b(select|insert|update|delete|drop|alter)\b/i;

// JSON-like object or array (very rough structural check)
// Example: {...}, [...]
export const JSON_LIKE_REGEX = /^\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/;

// Spreadsheet / CSV formula injection (common patterns at start)
// Example: =SUM(...), +CMD, @A1
export const FORMULA_INJECTION_REGEX = /^[=+@].+/i;

// Control / non-printable characters (ASCII control range)
export const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F-\u009F]/;

// Low semantic content: this is handled by logic (letters/digits check),
// but regex above support the structural noise / control parts.