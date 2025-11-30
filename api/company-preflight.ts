// api/company-preflight.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
type PreflightErrorResponse = {
  error: string;
};
import {
  isDangerousCompanyText,
  isDangerousBenefitText
} from '../engine/validateDangerous';
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
  if (!text) return []
  const tokens = text.split(/[\s,.;:]+/)
  const patterns = [
  'inc',
  'ltd',
  'corp',
  'ab',
  'llc',
  'bank',
  'telecom',
  'group',
  'company',
  'corporation',
  'organization' // NEW: detect “organization’s” etc. as a generic org token
  ]
  const found: string[] = []
  for (const t of tokens) {
    const lower = t.toLowerCase()
    if (patterns.some(p => lower.includes(p))) {
      found.push(t)
    }
  }
  return found
}

function splitCompanyField(raw: string | null | undefined): { parts: string[]; malformed: boolean } {
  if (!raw) {
    return { parts: [], malformed: false }
  }

  const value = raw.trim()

  // Detect malformed patterns:
  //  - double separators (,, // && "and and")
  //  - leading separator
  //  - trailing separator
  const malformed =
    /,,/.test(value) ||
    /\/\//.test(value) ||
    /&&/.test(value) ||
    /\band and\b/i.test(value) ||
    /^[,\/&]/.test(value) ||
    /[,\/&]$/.test(value)

  const parts = value
    .split(/,|\/|&|\band\b/gi)
    .map(part => part.trim())
    .filter(part => part.length > 0)

  return { parts, malformed }
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
      throw { status: 400, error: 'Company field must be string.' }
    }

    if (row.strategic_benefit != null && typeof row.strategic_benefit !== 'string') {
      throw { status: 400, error: 'Strategic_benefit field must be string.' }
    }

    // Dangerous / low-signal checks (reuse engine rules)
    if (isDangerousCompanyText(row.company)) {
      throw {
        status: 400,
        error: 'Invalid text format for company.'
      }
    }

    if (isDangerousBenefitText(row.strategic_benefit)) {
      throw {
        status: 400,
        error: 'Invalid text format for strategic_benefit.'
      }
    }

    const { parts: colCompanies, malformed: malformedCompany } = splitCompanyField(row.company)
    if (malformedCompany) {
      malformed.push(row.row_id)
    }

    const benefitCompanies = detectCompanyInBenefit(row.strategic_benefit)
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

    let status: 'MATCH_SELECTED' | 'MATCH_GENERIC' | 'MISSING' | 'MISMATCH'
    let detected_company = ''

    if (!hasAny) {
      status = 'MISSING'
      missing.push(row.row_id)
      detected_company = ''
    } else {
      // Check generic tags
      const allGeneric = normalizedAll.length > 0 &&
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
      throw { status: 400, error: 'Company field must be string.' }
    }

    if (strategic_benefit != null && typeof strategic_benefit !== 'string') {
      throw { status: 400, error: 'Strategic_benefit field must be string.' }
    }

    // Dangerous / low-signal checks (reuse engine rules)
    if (isDangerousCompanyText(company)) {
      throw {
        status: 400,
        error: 'Invalid text format for company.'
      }
    }

    if (isDangerousBenefitText(strategic_benefit)) {
      throw {
        status: 400,
        error: 'Invalid text format for strategic_benefit.'
      }
    }

    const { parts: colCompanies } = splitCompanyField(company)
    const benefitCompanies = detectCompanyInBenefit(strategic_benefit)
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


    /* -------------------------
       Missing company?
    -------------------------- */
    if (apply_to_missing && !hasAny) {
      if (generic_mode) {
        company = ''
        if (!strategic_benefit.trim()) {
          strategic_benefit = 'Support the organization’s strategic objectives'
        }
      } else {
        company = selected_company
        if (!strategic_benefit.trim()) {
          strategic_benefit = `Support ${selected_company}’s strategic objectives`
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
    const errorBody: PreflightErrorResponse = { error: 'Method Not Allowed' }
    return res.status(405).json(errorBody)
  }
  

  let body: PreflightRequest;

  // Parse JSON safely
  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body as PreflightRequest);
  } catch {
    const errorBody: PreflightErrorResponse = { error: 'Invalid JSON body.' }
    return res.status(400).json(errorBody)
  }
  // Basic structure validation
  if (!body || typeof body !== 'object') {
    const errorBody: PreflightErrorResponse = { error: 'Invalid request structure.' }
    return res.status(400).json(errorBody)
  }

  if (!('rows' in body) || !Array.isArray((body as any).rows)) {
    const errorBody: PreflightErrorResponse = { error: 'Missing or invalid rows array.' }
    return res.status(400).json(errorBody)
  }

  // Validate generic_mode
  if (typeof (body as any).generic_mode !== 'boolean') {
    const errorBody: PreflightErrorResponse = { error: 'generic_mode must be boolean.' }
    return res.status(400).json(errorBody)
  }

  // Validate selected_company for non-generic mode
  if ((body as any).mode === 'analyze' || (body as any).mode === 'rewrite') {
    const genericMode = (body as any).generic_mode as boolean
    const selectedCompany = ((body as any).selected_company || '').toString().trim()

    if (!genericMode && !selectedCompany) {
      const errorBody: PreflightErrorResponse = { error: 'Missing selected_company for non-generic mode.' }
      return res.status(400).json(errorBody)
    }
  }

  // Rewrite-specific validation
  if ((body as any).mode === 'rewrite') {
    const rewrite = body as RewriteRequest

    if (typeof rewrite.apply_to_missing !== 'undefined' && typeof rewrite.apply_to_missing !== 'boolean') {
      const errorBody: PreflightErrorResponse = { error: 'apply_to_missing must be boolean.' }
      return res.status(400).json(errorBody)
    }

    if (
      typeof rewrite.mismatched_strategy !== 'undefined' &&
      rewrite.mismatched_strategy !== 'overwrite' &&
      rewrite.mismatched_strategy !== 'keep'
    ) {
      const errorBody: PreflightErrorResponse = { error: 'Invalid mismatched_strategy.' }
      return res.status(400).json(errorBody)
    }
  }

  try {
    if (body.mode === 'analyze') {
      const out = runAnalyze(body as AnalyzeRequest);
      return res.status(200).json(out);
    }

    if (body.mode === 'rewrite') {
      const out = runRewrite(body as RewriteRequest);
      return res.status(200).json(out);
    }

    const errorBody: PreflightErrorResponse = { error: 'Invalid mode.' }
    return res.status(400).json(errorBody)
  } catch (err) {
    console.error('company-preflight error:', err)
    const errorBody: PreflightErrorResponse = {
      error: 'Internal company-preflight error.'
    }
    return res.status(500).json(errorBody)
  }
}