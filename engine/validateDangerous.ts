// engine/validateDangerous.ts
// High-security dangerous-text detection for KPI Engine v10.7.5 (Option C-FULL)

import {
  HTML_TAG_REGEX,
  SCRIPT_XSS_REGEX,
  SQL_KEYWORD_REGEX,
  JSON_LIKE_REGEX,
  FORMULA_INJECTION_REGEX,
  CONTROL_CHAR_REGEX
} from './regex';

import { ErrorCodes, addErrorCode } from './errorCodes';
import type { ErrorCode } from './errorCodes';

/**
 * Checks for dangerous or low-signal content (HTML/JS/SQL/code injection, formulas,
 * control characters, and non-semantic noise).
 *
 * Returns:
 *  - isDangerous: true if text MUST be rejected (E401)
 *  - isLowSemantic: true if text contains no meaningful alphanumeric signal (E402)
 *
 * Notes:
 *  - Error codes are category-level (E401 / E402); caller decides which field failed.
 *  - Contract matches 06_System_error_spec, 07_Domain_Validation_Spec, 10_Sanitization_Spec, and 11_Assembler.
 */
export function checkDangerousText(
  rawValue: string | undefined | null,
  _fieldName: string,     // kept for logging / diagnostics; not used in code selection
  errorCodes: ErrorCode[] // STRICT typed error code bucket
): { isDangerous: boolean; isLowSemantic: boolean } {
  const value = (rawValue ?? '').toString();

  // Empty → not dangerous but low semantic. Missing-ness is handled by domain validator.
  const trimmed = value.trim();
  if (!trimmed) {
    return { isDangerous: false, isLowSemantic: true };
  }

  // ----------------------------------------------------
  // 1. Dangerous patterns (E401)
  // ----------------------------------------------------

  // 1.1 HTML tags (generic) → E401
  if (HTML_TAG_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.2 Script / XSS patterns → E401
  if (SCRIPT_XSS_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.3 SQL injection keywords / fragments → E401
  if (SQL_KEYWORD_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.4 JSON-like blobs (raw code paste) → E401
  if (JSON_LIKE_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.5 Spreadsheet formula injection → E401
  if (FORMULA_INJECTION_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.6 Control characters → E401
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // 1.7 Extra HTML/JS injection helpers (backticks, template, HTML attack surface) → E401
  const lower = trimmed.toLowerCase();
  if (
    trimmed.includes('`') ||          // backticks (JS template literals)
    trimmed.includes('${') ||         // template injection markers
    lower.includes('<img') ||
    lower.includes('<iframe') ||
    lower.includes('</script')
  ) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // ----------------------------------------------------
  // 2. Low-signal / non-semantic content (E402)
  // ----------------------------------------------------

  // 2.1 Rule: if the string contains NO alphanumeric characters at all, it is low-signal noise.
  // This covers emoji-only and pure punctuation content (e.g. "😀", ".", "-").
  if (!/[A-Za-z0-9]/.test(trimmed)) {
    addErrorCode(errorCodes, ErrorCodes.LOW_SIGNAL_TEXT);
    return { isDangerous: false, isLowSemantic: true };
  }

  // 2.2 Repeated low-signal tokens such as "and and and"
  // Heuristic:
  //  - At least 3 tokens.
  //  - All tokens are the same short word (length <= 4).
  // This safely classifies patterns like "and and and" (NEG_stopwords_benefit_invalid)
  // as low-signal while leaving normal sentences untouched.
  const simpleTokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (simpleTokens.length >= 3) {
    const uniqueTokens = Array.from(new Set(simpleTokens));
    if (uniqueTokens.length === 1) {
      const token = uniqueTokens[0];
      if (token.length <= 4) {
        addErrorCode(errorCodes, ErrorCodes.LOW_SIGNAL_TEXT);
        return { isDangerous: false, isLowSemantic: true };
      }
    }
  }

  // ----------------------------------------------------
  // 3. Otherwise, safe and semantically meaningful
  // ----------------------------------------------------
  return {
    isDangerous: false,
    isLowSemantic: false
  };
  
}

// Metric labels used in error messages
const METRIC_LABELS = {
  output: 'Output',
  quality: 'Quality',
  improvement: 'Improvement',
} as const;

export interface MetricsDangerousResult {
  // Names for the CSV / comments layer: "Output", "Quality", "Improvement"
  dangerousMetrics: string[];
}

/**
 * Evaluate all three metric fields (Output / Quality / Improvement) for
 * dangerous / low-signal content, but only add ONE dangerous-text / low-signal
 * error category (E401 / E402) via checkDangerousText.
 *
 * - Uses checkDangerousText() for each non-empty metric.
 * - Relies on addErrorCode() de-duplication to keep a single E401/E402 in the list.
 * - Returns the *labels* of metrics that were flagged as dangerous or low-signal.
 */
export function evaluateMetricsDangerous(
  output: string | null | undefined,
  quality: string | null | undefined,
  improvement: string | null | undefined,
  errorCodes: ErrorCode[]
): MetricsDangerousResult {
  const dangerousMetrics: string[] = [];

  const metrics = [
    { value: output,      label: METRIC_LABELS.output },
    { value: quality,     label: METRIC_LABELS.quality },
    { value: improvement, label: METRIC_LABELS.improvement },
  ];

  for (const metric of metrics) {
    const raw = metric.value;
    if (raw == null) continue;

    // Let checkDangerousText handle trimming and classification.
    const { isDangerous, isLowSemantic } = checkDangerousText(
      raw,
      metric.label,
      errorCodes
    );

    // Empty strings are treated as "missing" by domain/metricsAutoSuggest,
    // so only flag metrics with actual dangerous / low-signal content.
    const trimmed = String(raw).trim();
    if (!trimmed) continue;

    if (isDangerous || isLowSemantic) {
      dangerousMetrics.push(metric.label);
    }
  }

  return { dangerousMetrics };
}