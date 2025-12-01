// api/company-preflight.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  isDangerousCompanyText,
  isDangerousBenefitText
} from '../engine/validateDangerous';
import {
  DEFAULT_COMPANY_TOKEN_PATTERNS,
  MAX_COMPANY_TOKENS,
  MAX_PREFLIGHT_ROWS,
  COMPANY_SUFFIX_TOKENS
} from '../engine/constants';
import { DEFAULT_TENANT_CONFIG } from '../engine/config';
import { toSafeTrimmedString } from '../engine/normalizeFields';

type PreflightErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_MODE'
  | 'INVALID_JSON_BODY'
  | 'INVALID_REQUEST_STRUCTURE'
  | 'MISSING_ROWS_ARRAY'
  | 'GENERIC_MODE_NOT_BOOLEAN'
  | 'MISSING_SELECTED_COMPANY'
  | 'APPLY_TO_MISSING_NOT_BOOLEAN'
  | 'INVALID_MISMATCHED_STRATEGY'
  | 'COMPANY_NOT_STRING'
  | 'BENEFIT_NOT_STRING'
  | 'INVALID_TEXT_COMPANY'
  | 'INVALID_TEXT_BENEFIT'
  | 'REQUEST_BODY_TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'INTERNAL_PREFLIGHT_ERROR';

type PreflightErrorResponse = {
  error: string;            // human-readable text
  code: PreflightErrorCode; // machine-readable for GPT
  hint?: string;            // optional UX hint (e.g. "ask_for_selected_company")
};
/* -----------------------------------------------------------
   Types
----------------------------------------------------------- */

interface RowIn {
  row_id: number
  company: string
  strategic_benefit: string

  task_name?: string
  task_type?: string
  team_role?: string
  dead_line?: string
  output_metric?: string
  quality_metric?: string
  improvement_metric?: string
  mode?: string
}

interface AnalyzeRequest {
  mode: 'analyze'
  selected_company: string   // "" if generic mode
  generic_mode: boolean
  rows: RowIn[]
}

interface RewriteRequest {
  mode: 'rewrite'
  selected_company: string
  generic_mode: boolean
  apply_to_missing?: boolean
  mismatched_strategy?: 'overwrite' | 'keep'
  rows: RowIn[]
}

interface AnalyzeResponse {
  missing_company_rows: number[]
  mismatched_company_rows: number[]
  malformed_company_rows: number[]
  external_company_names: string[]
  per_row_status: {
    row_id: number
    status: 'MATCH_SELECTED' | 'MATCH_GENERIC' | 'MISSING' | 'MISMATCH'
    detected_company: string
  }[]
}

interface RewriteResponse {
  rows: RowIn[]
}

type PreflightRequest = AnalyzeRequest | RewriteRequest


// -----------------------------------------------------------
// // ========== Observability: Logging + Metrics ==========
// -----------------------------------------------------------

// Simple structured logging helpers
function logPreflightInfo(event: string, ctx: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      level: 'info',
      service: 'company-preflight',
      event,
      ...ctx
    })
  );
}

function logPreflightWarn(event: string, ctx: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'company-preflight',
      event,
      ...ctx
    })
  );
}

function logPreflightError(event: string, ctx: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'company-preflight',
      event,
      ...ctx
    })
  );
}

// Helper: never log full benefit text
function summarizeBenefit(benefit: unknown): string | null {
  if (typeof benefit !== 'string') return null;
  const trimmed = benefit.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 77) + '...';
}


// -----------------------------------------------------------
// Simple in-memory metrics (per runtime instance)
// -----------------------------------------------------------
let preflightRequestsTotal = 0;
let preflightRequests400 = 0;
let preflightRequests500 = 0;
let preflightMalformedRowsTotal = 0;

/* -----------------------------------------------------------
   Helpers
----------------------------------------------------------- */

function normalize(str: string | null | undefined): string {
  const raw = (str || '').trim().toLowerCase()
  if (!raw) return ''

  // Strip English-style possessive endings: "acme's", "acme’s"
  let cleaned = raw.replace(/['’]s\b/g, '')

  // Normalize known generic tokens so they can be treated consistently
  if (cleaned === 'organization') return 'the organization'
  if (cleaned === 'company') return 'the company'

  return cleaned
}

// Very simple company-token detector inside strategic_benefit
function detectCompanyInBenefit(text: string): string[] {
  if (!text) return [];

  const tokens = text.split(/[\s,.;:]+/);
  const found: string[] = [];

  // NEW: detect tokens that *end* with a known suffix (e.g. "BetaCorp", "GammaGroup")
  const suffixEndRegex = new RegExp(
    `(${COMPANY_SUFFIX_TOKENS.join('|')})$`,
    'i'
  );

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // 1) Existing pattern-based detection (unchanged)
    if (DEFAULT_COMPANY_TOKEN_PATTERNS.some(p => lower.includes(p))) {
      found.push(token);
      continue;
    }

    // 2) NEW: detect things like "BetaCorp", "GammaGroup", "FooTelecom", "CoreAB"
    if (suffixEndRegex.test(token)) {
      found.push(token);
      continue;
    }
  }

  return found;
}

function enrichWithSuffixCompanies(
  text: string | null | undefined,
  existing: string[]
): string[] {
  const value = toSafeTrimmedString(text);
  if (!value) return existing;

  const out = [...existing];
  const seen = new Set(out.map(t => t.toLowerCase()));

  const suffixAlt = COMPANY_SUFFIX_TOKENS.join('|'); // bank|group|telecom|corp|ab
  const regex = new RegExp(
  `\\b([A-Z][A-Za-z0-9]*(?:[-\\s][A-Z][A-Za-z0-9]*)*)\\s+(${suffixAlt})\\b`,
  'gi'   // case-insensitive
);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const rawName = match[1].trim();     // e.g. "ACME", "GAMMA"
    const rawSuffix = match[2].trim();   // e.g. "Bank"
    const full = `${rawName} ${rawSuffix}`; // "ACME Bank", "GAMMA group"
    const norm = full.toLowerCase();

    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(full);
    }
  }

  return out;
}

function splitCompanyField(
  raw: string | null | undefined
): { parts: string[]; malformed: boolean } {
  // Normalize input to a safe, trimmed string
  const value = toSafeTrimmedString(raw);

  if (!value) {
    return { parts: [], malformed: false };
  }
// 1) Pattern-based malformed detection
    let malformed =
    /,,/.test(value) ||              // double commas
    /\/\//.test(value) ||            // double slashes
    /&&/.test(value) ||              // double ampersands
    /\band and\b/i.test(value) ||    // "and and"
    /\/\s+\/\s*/.test(value) ||      // NEW: "/ /" or "/   /" => empty company between slashes
    /^[,\/&]/.test(value) ||         // leading separator
    /[,\/&]$/.test(value);           // trailing separator
    
  // 2) Tokenization
  const parts = value
    .split(/,|\/|&|\band\b/gi)
    .map(part => part.trim())
    .filter(part => part.length > 0);

  // 3) Too many tokens → malformed
  if (parts.length > MAX_COMPANY_TOKENS) {
    malformed = true;
  }

  // Respect tenant policy for multi-company per row
  if (!DEFAULT_TENANT_CONFIG.policy.allowMultiCompanyPerRow && parts.length > 1) {
    malformed = true;
  }

  return { parts, malformed };
}

/* -----------------------------------------------------------
   ANALYZE LOGIC
----------------------------------------------------------- */

/* Helper: extracts instance of the selected company from strategic_benefit if mentioned explicitly */
function selectedFromBenefitExtractor(text: string, selectedNorm: string): string[] {
  if (!text || !selectedNorm) return []
  const tokens = text.split(/[\s,.;:]+/)
  const matches: string[] = []
  for (const t of tokens) {
    if (t.toLowerCase().includes(selectedNorm)) {
      matches.push(t)
    }
  }
  return matches
}

function runAnalyze(payload: AnalyzeRequest): AnalyzeResponse {
  const { selected_company, generic_mode, rows } = payload
  const selectedNorm = normalize(selected_company)

  const missing: number[] = []
  const mismatched: number[] = []
  const malformed: number[] = []
  const externalNames = new Set<string>()
  const perRow: AnalyzeResponse['per_row_status'] = []

  for (const row of rows) {
    // Type checks for company / strategic_benefit
   if (row.company != null && typeof row.company !== 'string') {
  throw { status: 400, error: 'Company field must be string.', code: 'COMPANY_NOT_STRING' };
}

if (row.strategic_benefit != null && typeof row.strategic_benefit !== 'string') {
  throw {
    status: 400,
    error: 'Strategic_benefit field must be string.',
    code: 'BENEFIT_NOT_STRING'
  };
}

if (isDangerousCompanyText(row.company)) {
  throw {
    status: 400,
    error: 'Invalid text format for company.',
    code: 'INVALID_TEXT_COMPANY'
  };
}

if (isDangerousBenefitText(row.strategic_benefit)) {
  throw {
    status: 400,
    error: 'Invalid text format for strategic_benefit.',
    code: 'INVALID_TEXT_BENEFIT'
  };
}

    const { parts: colCompanies, malformed: malformedCompany } = splitCompanyField(row.company)
    if (malformedCompany) {
      malformed.push(row.row_id)
    }

    let benefitCompanies = detectCompanyInBenefit(row.strategic_benefit)
    benefitCompanies = enrichWithSuffixCompanies(row.strategic_benefit, benefitCompanies)
    const selectedFromBenefit = selectedFromBenefitExtractor(row.strategic_benefit, selectedNorm)


    
    // All detected companies in display form
    const allCompanies: string[] = []
    allCompanies.push(...colCompanies)
    allCompanies.push(...benefitCompanies)
    
    // If the benefit explicitly mentions the selected company, ensure it is included
    if (selectedFromBenefit.length > 0) {
      allCompanies.push(...selectedFromBenefit)
    }

    const normalizedAll = allCompanies.map(c => normalize(c))
    const hasAny = allCompanies.length > 0

    // NEW: detect generic organization/company wording when in generic_mode,
    // even if no explicit company tokens were extracted.
    const benefitText = (row.strategic_benefit || '').toLowerCase()
    const genericFromText =
      generic_mode &&
      /\b(organisation|organization|company|företaget|företag)\b/.test(benefitText)

    let status: 'MATCH_SELECTED' | 'MATCH_GENERIC' | 'MISSING' | 'MISMATCH'
    let detected_company = ''

    if (!hasAny) {
      if (genericFromText) {
        // Generic mode + generic org wording → treat as MATCH_GENERIC
        status = 'MATCH_GENERIC'
        detected_company = 'the organization'
        // NOTE: do NOT push into missing_company_rows
      } else {
        status = 'MISSING'
        missing.push(row.row_id)
        detected_company = ''
      }
    } else {
      // Check generic tags
      const allGeneric =
        normalizedAll.length > 0 &&
        normalizedAll.every(n => n === 'the company' || n === 'the organization')

      if (generic_mode && allGeneric) {
        status = 'MATCH_GENERIC'
        detected_company = allCompanies.join('; ')
      } else {
        // Non-generic evaluation vs selected company
        const allMatchSelected =
          !!selectedNorm &&
          normalizedAll.length > 0 &&
          normalizedAll.every(n => n === selectedNorm || n === '')

        if (allMatchSelected) {
          status = 'MATCH_SELECTED'
          detected_company = allCompanies.join('; ')
        } else {
          status = 'MISMATCH'
          mismatched.push(row.row_id)
          detected_company = allCompanies.join('; ')
          for (const c of allCompanies) {
            const normC = normalize(c)
            if (
              normC &&
              normC !== selectedNorm &&
              normC !== 'the company' &&
              normC !== 'the organization'
            ) {
              externalNames.add(c)
            }
          }
        }
      }
    }

    perRow.push({
      row_id: row.row_id,
      status,
      detected_company
    })
  }
  return {
    missing_company_rows: missing,
    mismatched_company_rows: mismatched,
    malformed_company_rows: malformed,
    external_company_names: Array.from(externalNames),
    per_row_status: perRow
  }
}

/* -----------------------------------------------------------
   REWRITE LOGIC
----------------------------------------------------------- */

function runRewrite(payload: RewriteRequest): RewriteResponse {
  const {
    rows, selected_company, generic_mode,
    apply_to_missing, mismatched_strategy
  } = payload

  const selectedNorm = normalize(selected_company)

  const updated = rows.map(row => {
    let { company, strategic_benefit } = row

    // Type checks for company / strategic_benefit
   if (company != null && typeof company !== 'string') {
  throw { status: 400, error: 'Company field must be string.', code: 'COMPANY_NOT_STRING' };
}

if (strategic_benefit != null && typeof strategic_benefit !== 'string') {
  throw {
    status: 400,
    error: 'Strategic_benefit field must be string.',
    code: 'BENEFIT_NOT_STRING'
  };
}

if (isDangerousCompanyText(company)) {
  throw {
    status: 400,
    error: 'Invalid text format for company.',
    code: 'INVALID_TEXT_COMPANY'
  };
}

if (isDangerousBenefitText(strategic_benefit)) {
  throw {
    status: 400,
    error: 'Invalid text format for strategic_benefit.',
    code: 'INVALID_TEXT_BENEFIT'
  };
}

    const { parts: colCompanies } = splitCompanyField(company)
    let benefitCompanies = detectCompanyInBenefit(strategic_benefit)
    benefitCompanies = enrichWithSuffixCompanies(strategic_benefit, benefitCompanies)
    const selectedFromBenefit = selectedFromBenefitExtractor(strategic_benefit, selectedNorm)

    const allCompanies: string[] = []
    allCompanies.push(...colCompanies)
    allCompanies.push(...benefitCompanies)
    if (selectedFromBenefit.length > 0) {
      allCompanies.push(...selectedFromBenefit)
    }

    const colNorms = colCompanies.map(c => normalize(c))
    const benefitNorms = benefitCompanies.map(c => normalize(c))
    const hasAny = allCompanies.length > 0


        // -------------------------
    // Missing company / missing benefit handling
    // -------------------------
    const benefitTrimmed = (strategic_benefit || '').trim();
    const benefitEmpty = benefitTrimmed.length === 0;

    if (apply_to_missing) {
      // 1) If we have NO detectable company tokens at all, fill company.
      if (!hasAny) {
        if (generic_mode) {
          // Generic: keep company empty, rely on benefit wording
          company = '';
        } else {
          // Named: attach the selected company
          company = selected_company;
        }
      }

      // 2) If benefit text is empty, seed a strategic benefit sentence.
      if (benefitEmpty) {
        if (generic_mode) {
          strategic_benefit = 'Support the organization’s strategic objectives';
        } else if (selected_company.trim()) {
          strategic_benefit = `Support ${selected_company}’s strategic objectives`;
        } else {
          // Safety fallback if selected_company somehow blank
          strategic_benefit = 'Support the organization’s strategic objectives';
        }
      }
    }

    /* -------------------------
       Mismatched?
    -------------------------- */
    for (const comp of allCompanies) {
      if (mismatched_strategy === 'overwrite' && normalize(comp) !== selectedNorm) {
        if (generic_mode) {
          company = ''
          strategic_benefit = strategic_benefit.replace(comp, 'the organization')
        } else {
          company = selected_company
          strategic_benefit = strategic_benefit.replace(comp, selected_company)
        }
      }
    }

    // keep = no change

    return {
      ...row,
      company,
      strategic_benefit
    }
  })

  return { rows: updated }
}

/* -----------------------------------------------------------
   HANDLER
----------------------------------------------------------- */

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    const errorBody: PreflightErrorResponse = {
    error: 'Method Not Allowed',
    code: 'METHOD_NOT_ALLOWED'
  };
  return res.status(405).json(errorBody);
}
  // Count every POST preflight request
  preflightRequestsTotal++;

  let body: PreflightRequest;

  // Parse JSON safely
  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body as PreflightRequest);
  } catch {
  const errorBody: PreflightErrorResponse = {
    error: 'Invalid JSON body.',
    code: 'INVALID_JSON_BODY'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: errorBody.error,
    mode: null,
    generic_mode: null,
    rows_count: null
  });
  return res.status(400).json(errorBody);
}

    // Enforce body-size limit (payload safety) using string length
  // Enforce body-size limit (payload safety)
const MAX_BODY_CHARS = 1 * 1024 * 1024; // 1 MB (approx; JSON string length)

try {
  const serialized = JSON.stringify(body);
  const approxSize = serialized.length;

  if (approxSize > MAX_BODY_CHARS) {
    const errorBody: PreflightErrorResponse = {
      error: 'Request body too large.',
      code: 'REQUEST_BODY_TOO_LARGE'
    };
    preflightRequests400++;
    logPreflightWarn('request_rejected_400', {
      reason: errorBody.error,
      approx_size: approxSize,
      max_size: MAX_BODY_CHARS,
      mode: (body as any).mode ?? null,
      generic_mode: (body as any).generic_mode ?? null,
      rows_count: Array.isArray((body as any).rows)
        ? (body as any).rows.length
        : null
    });
    return res.status(400).json(errorBody);
  }
} catch {
  const errorBody: PreflightErrorResponse = {
    error: 'Invalid request structure.',
    code: 'INVALID_REQUEST_STRUCTURE'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: 'Invalid request structure on size check.',
    mode: null,
    generic_mode: null,
    rows_count: null
  });
  return res.status(400).json(errorBody);
}
  // Basic structure validation
if (!body || typeof body !== 'object') {
  const errorBody: PreflightErrorResponse = {
    error: 'Invalid request structure.',
    code: 'INVALID_REQUEST_STRUCTURE'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: errorBody.error,
    mode: null,
    generic_mode: null,
    rows_count: null
  });
  return res.status(400).json(errorBody);
}

if (!('rows' in body) || !Array.isArray((body as any).rows)) {
  const errorBody: PreflightErrorResponse = {
    error: 'Missing or invalid rows array.',
    code: 'MISSING_ROWS_ARRAY'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: errorBody.error,
    mode: (body as any).mode ?? null,
    generic_mode: (body as any).generic_mode ?? null,
    rows_count: null
  });
  return res.status(400).json(errorBody);
}

  const rowsCount = (body as any).rows.length;

  logPreflightInfo('request_received', {
    mode: (body as any).mode ?? null,
    generic_mode: (body as any).generic_mode ?? null,
    selected_company: (body as any).selected_company ?? '',
    rows_count: rowsCount
  });

  if (rowsCount > MAX_PREFLIGHT_ROWS) {
  const errorBody: PreflightErrorResponse = {
    error: 'Too many rows in preflight request.',
    code: 'TOO_MANY_ROWS'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: errorBody.error,
    mode: (body as any).mode ?? null,
    generic_mode: (body as any).generic_mode ?? null,
    rows_count: rowsCount,
    max_rows: MAX_PREFLIGHT_ROWS
  });
  return res.status(400).json(errorBody);
}
  // Validate generic_mode
  if (typeof (body as any).generic_mode !== 'boolean') {
  const errorBody: PreflightErrorResponse = {
    error: 'generic_mode must be boolean.',
    code: 'GENERIC_MODE_NOT_BOOLEAN'
  };
  preflightRequests400++;
  logPreflightWarn('request_rejected_400', {
    reason: errorBody.error,
    mode: (body as any).mode ?? null,
    generic_mode: (body as any).generic_mode ?? null,
    rows_count: (body as any).rows ? (body as any).rows.length : null
  });
  return res.status(400).json(errorBody);
}

  // Validate selected_company for non-generic mode
  if ((body as any).mode === 'analyze' || (body as any).mode === 'rewrite') {
  const genericMode = (body as any).generic_mode as boolean;
  const selectedCompany = ((body as any).selected_company || '').toString().trim();

  if (!genericMode && !selectedCompany) {
    const errorBody: PreflightErrorResponse = {
      error: 'Missing selected_company for non-generic mode.',
      code: 'MISSING_SELECTED_COMPANY',
      hint: 'ask_for_selected_company'
    };
    preflightRequests400++;
    logPreflightWarn('request_rejected_400', {
      reason: errorBody.error,
      mode: (body as any).mode ?? null,
      generic_mode: genericMode,
      rows_count: (body as any).rows ? (body as any).rows.length : null
    });
    return res.status(400).json(errorBody);
  }
}

  // Rewrite-specific validation
  if ((body as any).mode === 'rewrite') {
    const rewrite = body as RewriteRequest;

    if (typeof rewrite.apply_to_missing !== 'undefined' &&
    typeof rewrite.apply_to_missing !== 'boolean') {
      const errorBody: PreflightErrorResponse = {
        error: 'apply_to_missing must be boolean.',
        code: 'APPLY_TO_MISSING_NOT_BOOLEAN'
      };
      preflightRequests400++;
      logPreflightWarn('request_rejected_400', {
        reason: errorBody.error,
        mode: rewrite.mode,
        generic_mode: rewrite.generic_mode,
        rows_count: rewrite.rows.length
      });
      return res.status(400).json(errorBody);
    }

    if (
      typeof rewrite.mismatched_strategy !== 'undefined' &&
      rewrite.mismatched_strategy !== 'overwrite' &&
      rewrite.mismatched_strategy !== 'keep'
    ) {
      const errorBody: PreflightErrorResponse = {
        error: 'Invalid mismatched_strategy.',
        code: 'INVALID_MISMATCHED_STRATEGY'
      };
      preflightRequests400++;
      logPreflightWarn('request_rejected_400', {
        reason: errorBody.error,
        mode: rewrite.mode,
        generic_mode: rewrite.generic_mode,
        rows_count: rewrite.rows.length
      });
      return res.status(400).json(errorBody);
    }
  }

  try {
    if (body.mode === 'analyze') {
      const out = runAnalyze(body as AnalyzeRequest);
      // NEW: accumulate malformed rows count
      preflightMalformedRowsTotal += out.malformed_company_rows.length;

      logPreflightInfo('request_completed_200', {
        mode: 'analyze',
        generic_mode: (body as any).generic_mode,
        selected_company: (body as any).selected_company ?? '',
        rows_count: (body as any).rows.length,
        missing_count: out.missing_company_rows.length,
        mismatched_count: out.mismatched_company_rows.length,
        malformed_count: out.malformed_company_rows.length
      });
      return res.status(200).json(out);
    }

    if (body.mode === 'rewrite') {
      const out = runRewrite(body as RewriteRequest);
      logPreflightInfo('request_completed_200', {
        mode: 'rewrite',
        generic_mode: (body as any).generic_mode,
        selected_company: (body as any).selected_company ?? '',
        rows_count: (body as any).rows.length
      });
      return res.status(200).json(out);
    }

const errorBody: PreflightErrorResponse = {
  error: 'Invalid mode.',
  code: 'INVALID_MODE'
};
preflightRequests400++;
logPreflightWarn('request_rejected_400', {
  reason: errorBody.error,
  mode: (body as any).mode ?? null,
  generic_mode: (body as any).generic_mode ?? null,
  rows_count: (body as any).rows ? (body as any).rows.length : null
});
return res.status(400).json(errorBody);

  } catch (err: any) {
  // Propagate structured errors thrown from runAnalyze / runRewrite
  if (err && typeof err === 'object' && 'status' in err && 'error' in err) {
    const status = typeof (err as any).status === 'number' ? (err as any).status : 400;
    const message = String((err as any).error || 'Unknown company-preflight error.');

    const errorBody: PreflightErrorResponse = {
      error: message,
      code: (err as any).code ?? 'INTERNAL_PREFLIGHT_ERROR',
      hint: (err as any).hint
    };

    if (status >= 500) {
      preflightRequests500++;
      logPreflightError('request_failed_500', {
        status,
        message
      });
    } else {
      preflightRequests400++;
      logPreflightWarn('request_rejected_400', {
        reason: message,
        mode: (body as any)?.mode ?? null,
        generic_mode: (body as any)?.generic_mode ?? null,
        rows_count: (body as any)?.rows ? (body as any).rows.length : null
      });
    }

    return res.status(status).json(errorBody);
  }

  // Fallback for unexpected errors
  preflightRequests500++;
  logPreflightError('request_failed_500', {
    status: 500,
    message: 'Internal company-preflight error.',
    rawError: String(err)
  });

  const errorBody: PreflightErrorResponse = {
    error: 'Internal company-preflight error.',
    code: 'INTERNAL_PREFLIGHT_ERROR'
  };
  return res.status(500).json(errorBody);
  }
} 