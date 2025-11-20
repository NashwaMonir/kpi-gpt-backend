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
  const {
    row_id,
    task_name,
    team_role,
    dead_line,
    strategic_benefit
  } = row

  const simple_objective =
    `Deliver '${task_name}' for ${team_role} by ${dead_line} ` +
    `to support ${strategic_benefit}.`

  return {
    row_id,
    simple_objective,
    complex_objective: '',
    status: 'NEEDS_REVIEW',
    comments:
      'Placeholder objectives only. v10.7.5 KPI logic not yet implemented.',
    summary_reason:
      'Engine skeleton responding without full KPI rules.'
  }
}

// -------- Vercel handler --------

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = (req.body || {}) as KpiRequest

    if (!body.rows || !Array.isArray(body.rows)) {
      return res.status(400).json({ error: 'Missing or invalid rows array.' })
    }

    const rowsOut: KpiRowOut[] = body.rows.map((row) => processRow(row))
    const response: KpiResponse = { rows: rowsOut }

    return res.status(200).json(response)
  } catch (err) {
    console.error('KPI engine error:', err)
    return res.status(500).json({ error: 'Internal KPI engine error.' })
  }
}