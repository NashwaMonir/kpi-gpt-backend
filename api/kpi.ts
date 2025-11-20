// api/kpi.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

// -------- Types matching the GPT Action schema --------

type KpiRowIn = {
  row_id: number
  company?: string
  team_role: string
  task_type: string
  task_name: string
  dead_line: string
  output_metric?: string
  quality_metric?: string
  improvement_metric?: string
  strategic_benefit: string
  mode?: 'simple' | 'complex' | 'both'
}

type KpiRequest = {
  engine_version?: string
  default_company?: string
  rows: KpiRowIn[]
}

type KpiRowOut = {
  row_id: number
  simple_objective: string
  complex_objective: string
  status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID'
  comments: string
  summary_reason: string
}

type KpiResponse = {
  rows: KpiRowOut[]
}

// -------- Simple placeholder engine (to be replaced by v10.7.5 logic later) --------

function processRow(row: KpiRowIn): KpiRowOut {
  return {
    row_id: row.row_id,
    simple_objective: '',
    complex_objective: '',
    status: 'INVALID',
    comments: 'TEST_INVALID – forced by engine.',
    summary_reason: 'TEST_INVALID – forced by engine.'
  }
}


// -------- Vercel handler --------

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  let body: KpiRequest

  // --- Parse JSON safely ---
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }

// --- Validate structure ---
if (!body || typeof body !== 'object') {
  return res.status(400).json({ error: 'Invalid request structure.' })
}

if (!body.rows || !Array.isArray(body.rows)) {
  return res.status(400).json({ error: 'Missing or invalid rows array.' })
}

try {
  const rowsOut: KpiRowOut[] = body.rows.map((row) => processRow(row))
  const response: KpiResponse = { rows: rowsOut }
  return res.status(200).json(response)
} catch (err) {
  console.error('KPI engine error:', err)
  return res.status(500).json({ error: 'Internal KPI engine error.' })
}
}