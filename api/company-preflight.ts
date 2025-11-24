// api/company-preflight.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

/* -----------------------------------------------------------
   Types
----------------------------------------------------------- */

type PreflightMode = 'analyze' | 'rewrite'

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
  apply_to_missing: boolean | null
  mismatched_strategy: 'overwrite' | 'keep' | null
  rows: RowIn[]
}

interface AnalyzeResponse {
  missing_company_rows: number[]
  mismatched_company_rows: number[]
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
type PreflightResult = AnalyzeResponse | RewriteResponse

/* -----------------------------------------------------------
   Helpers
----------------------------------------------------------- */

function normalize(str: string | null | undefined): string {
  return (str || '').trim().toLowerCase()
}

// Very simple company-token detector inside strategic_benefit
function detectCompanyInBenefit(text: string): string[] {
  if (!text) return []
  const tokens = text.split(/[\s,.;:]+/)
  const patterns = [
    'inc','ltd','corp','ab','llc','bank','telecom','group','company','corporation'
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

function splitCompanyField(raw: string | null | undefined): string[] {
  if (!raw) return []
  // Split on common multi-company separators: ',', '/', '&', ' and '
  return raw
    .split(/,|\/|&|\band\b/gi)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

/* -----------------------------------------------------------
   ANALYZE LOGIC
----------------------------------------------------------- */

function runAnalyze(payload: AnalyzeRequest): AnalyzeResponse {
  const { selected_company, generic_mode, rows } = payload
  const selectedNorm = normalize(selected_company)

  const missing: number[] = []
  const mismatched: number[] = []
  const externalNames = new Set<string>()
  const perRow: AnalyzeResponse['per_row_status'] = []

  for (const row of rows) {
    const colCompanies = splitCompanyField(row.company)
    const benefitCompanies = detectCompanyInBenefit(row.strategic_benefit)

    // All detected companies in display form
    const allCompanies: string[] = []
    allCompanies.push(...colCompanies)
    allCompanies.push(...benefitCompanies)

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

    const colCompanies = splitCompanyField(company)
    const benefitCompanies = detectCompanyInBenefit(strategic_benefit)

    const allCompanies: string[] = []
    allCompanies.push(...colCompanies)
    allCompanies.push(...benefitCompanies)

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
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  let body: PreflightRequest
  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body as PreflightRequest)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request structure.' })
  }

  if (!('rows' in body) || !Array.isArray((body as any).rows)) {
    return res.status(400).json({ error: 'Missing or invalid rows array.' })
  }

  try {
    if (body.mode === 'analyze') {
      const out = runAnalyze(body)
      return res.status(200).json(out)
    }

    if (body.mode === 'rewrite') {
      const out = runRewrite(body)
      return res.status(200).json(out)
    }

    return res.status(400).json({ error: 'Invalid mode.' })

  } catch (err) {
    console.error('company-preflight error:', err)
    return res.status(500).json({ error: 'Internal company-preflight error.' })
  }
}