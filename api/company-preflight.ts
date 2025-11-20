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
function detectCompanyInBenefit(text: string): string | null {
  if (!text) return null

  const tokens = text.split(/[\s,.;:]+/)
  const patterns = [
    'inc','ltd','corp','ab','llc','bank','telecom','group','company','corporation'
  ]

  for (const t of tokens) {
    const lower = t.toLowerCase()
    if (patterns.some(p => lower.includes(p))) return t
  }
  return null
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
    const colCompany = row.company || ''
    const benefitCompany = detectCompanyInBenefit(row.strategic_benefit) || ''

    const colNorm = normalize(colCompany)
    const benefitNorm = normalize(benefitCompany)
    const hasAny = (!!colNorm) || (!!benefitNorm)

    let status: 'MATCH_SELECTED' | 'MATCH_GENERIC' | 'MISSING' | 'MISMATCH'
    let detected_company = colCompany || benefitCompany || ''

    if (!hasAny) {
      status = 'MISSING'
      missing.push(row.row_id)
    } else {
      const effective = colNorm || benefitNorm
      const raw = colCompany || benefitCompany

      const isGeneric =
        effective === 'the company' ||
        effective === 'the organization'

      if (generic_mode && isGeneric) {
        status = 'MATCH_GENERIC'
      } else if (!selectedNorm) {
        status = 'MATCH_GENERIC' // generic mode with no selected name
      } else {
        if (effective === selectedNorm) {
          status = 'MATCH_SELECTED'
        } else {
          status = 'MISMATCH'
          mismatched.push(row.row_id)
          if (raw) externalNames.add(raw)
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

    const colCompany = company || ''
    const benefitCompany = detectCompanyInBenefit(strategic_benefit) || ''

    const colNorm = normalize(colCompany)
    const benefitNorm = normalize(benefitCompany)
    const hasAny = (!!colNorm) || (!!benefitNorm)

    const effectiveName = colNorm || benefitNorm
    const effectiveRaw = colCompany || benefitCompany
    const isGenericTag =
      effectiveName === 'the company' || effectiveName === 'the organization'
    const isMismatch =
      !!selectedNorm && !!effectiveName && effectiveName !== selectedNorm && !isGenericTag

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
    if (mismatched_strategy === 'overwrite' && isMismatch) {
      if (generic_mode) {
        company = ''
        strategic_benefit = strategic_benefit.replace(effectiveRaw, 'the organization')
      } else {
        company = selected_company
        strategic_benefit = strategic_benefit.replace(effectiveRaw, selected_company)
      }
    }

    // keep = no change

    return {
      row_id: row.row_id,
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