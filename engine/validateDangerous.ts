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
import { toSafeTrimmedString } from './normalizeFields';
import { stripZeroWidthAndControl } from './regex';
import { MAX_TEXT_LENGTH } from './constants';
import { DEFAULT_TENANT_CONFIG } from './config';
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



export interface DangerousCheckResult {
  isDangerous: boolean;
  isLowSemantic: boolean;
}

export function checkDangerousText(
  rawValue: string | undefined | null,
  _fieldName: string,     // kept for logging / diagnostics; not used in code selection
  errorCodes: ErrorCode[] // STRICT typed error code bucket
): { isDangerous: boolean; isLowSemantic: boolean } {
  // Normalize + strip zero-width / control chars
  const raw = (rawValue ?? '').toString();
  const cleaned = stripZeroWidthAndControl(raw);

  // Empty → not dangerous but low semantic. Missing-ness is handled by domain validator.
  const trimmed = cleaned.trim();
  if (!trimmed) {
    return { isDangerous: false, isLowSemantic: true };
  }
 const cfg = DEFAULT_TENANT_CONFIG;
  // ----------------------------------------------------
  // 0. Length guard (very long payloads)
  // ----------------------------------------------------
  if (trimmed.length > MAX_TEXT_LENGTH) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // ----------------------------------------------------
  // 1. Dangerous patterns (E401)
  // ----------------------------------------------------

  // 1.1 HTML tags (generic) → E401
if (HTML_TAG_REGEX.test(trimmed)) {
  if (!cfg.policy.allowHtmlLikeCompany) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }
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

  // 1.7 Extra HTML/JS injection helpers and explicit policy/security-violating phrases → E401
  const lower = trimmed.toLowerCase();
  if (
    // HTML/JS surface indicators
    trimmed.includes('`') ||          // backticks (JS template literals)
    trimmed.includes('${') ||         // template injection markers
    lower.includes('<img') ||
    lower.includes('<iframe') ||
    lower.includes('</script') ||
    // Explicit dangerous instruction / policy-violating phrases
    lower.includes('by any means necessary') ||
    (lower.includes('ignoring') && lower.includes('security')) ||
    (lower.includes('ignoring') && lower.includes('guidelines')) ||
    (lower.includes('ignoring') && lower.includes('policy')) ||
    lower.includes('ignore security controls') ||
    lower.includes('ignore security guidelines')
  ) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }

  // ----------------------------------------------------
  // 2. Tenant-specific extra dangerous substrings
  // ----------------------------------------------------

 if (cfg.dangerous.extraDangerousSubstrings.length > 0) {
  const lower = trimmed.toLowerCase();
  if (cfg.dangerous.extraDangerousSubstrings.some(snippet =>
    lower.includes(snippet.toLowerCase())
  )) {
    addErrorCode(errorCodes, ErrorCodes.DANGEROUS_TEXT);
    return { isDangerous: true, isLowSemantic: false };
  }
}

  // ----------------------------------------------------
  // 3. Low-signal / non-semantic content (E402)
  // ----------------------------------------------------

  // 3.1 No alphanumeric chars → emoji/punctuation-only noise
  if (!/[A-Za-z0-9]/.test(trimmed)) {
  if (!cfg.policy.allowEmojiInBenefit) {
    addErrorCode(errorCodes, ErrorCodes.LOW_SIGNAL_TEXT);
    return { isDangerous: false, isLowSemantic: true };
  }
  // if allowed → treat as non-dangerous, non-low-signal
  return { isDangerous: false, isLowSemantic: false };
}

  // 2.2 Repeated low-signal tokens such as "and and and"
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
  // 4. Tenant-specific low-signal patterns
  // ----------------------------------------------------
if (cfg.dangerous.extraLowSignalPatterns.length > 0) {
    const lower = trimmed.toLowerCase();
    if (
      cfg.dangerous.extraLowSignalPatterns.some(pat =>
        lower.includes(pat.toLowerCase())
      )
    ) {
      addErrorCode(errorCodes, ErrorCodes.LOW_SIGNAL_TEXT);
      return { isDangerous: false, isLowSemantic: true };
    }
  }

  return { isDangerous: false, isLowSemantic: false };

}
  // ----------------------------------------------------
  // 5. Otherwise, safe and semantically meaningful
  // ----------------------------------------------------


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

    const { isDangerous, isLowSemantic } = checkDangerousText(
      raw,
      metric.label,
      errorCodes
    );

    const trimmed = String(raw).trim();
    if (!trimmed) continue;

    if (isDangerous || isLowSemantic) {
      dangerousMetrics.push(metric.label);
    }
  }

  return { dangerousMetrics };
}

export function isDangerousCompanyText(
  value: unknown,
  errorCodes: ErrorCode[] = []
): boolean {
  const trimmed = toSafeTrimmedString(value);
  if (!trimmed) return false;

  const { isDangerous, isLowSemantic } = checkDangerousText(
    trimmed,
    'Company',
    errorCodes
  );

  return isDangerous || isLowSemantic;
}

export function isDangerousBenefitText(
  value: unknown,
  errorCodes: ErrorCode[] = []
): boolean {
  const trimmed = toSafeTrimmedString(value);
  if (!trimmed) return false;

  const { isDangerous, isLowSemantic } = checkDangerousText(
    trimmed,
    'Strategic Benefit',
    errorCodes
  );

  return isDangerous || isLowSemantic;
}