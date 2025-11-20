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
    task_type,
    dead_line,
    strategic_benefit
  } = row

  // ------------------------
  // 1) Validate mandatory fields
  // ------------------------
  const missingFields: string[] = []

  if (!task_name || !String(task_name).trim()) {
    missingFields.push('Task Name')
  }
  if (!task_type || !String(task_type).trim()) {
    missingFields.push('Task Type')
  }
  if (!team_role || !String(team_role).trim()) {
    missingFields.push('Team Role')
  }
  if (!dead_line || !String(dead_line).trim()) {
    missingFields.push('Deadline')
  }
  if (!strategic_benefit || !String(strategic_benefit).trim()) {
    missingFields.push('Strategic Benefit')
  }

  if (missingFields.length > 0) {
    const reason = `Invalid: Missing mandatory field(s): ${missingFields.join(
      ', '
    )}.`

    return {
      row_id,
      simple_objective: '',
      complex_objective: '',
      status: 'INVALID',
      comments: reason,
      summary_reason: reason
    }
  }

  // ------------------------
  // 2) Validate deadline = current calendar year
  // ------------------------
  let deadlineYear: number | null = null
  try {
    const parts = String(dead_line).split('-')
    if (parts.length === 3) {
      deadlineYear = Number(parts[0])
    }
  } catch {
    deadlineYear = null
  }

  const currentYear = new Date().getFullYear()

  if (!deadlineYear || deadlineYear !== currentYear) {
    const reason = 'Invalid: Deadline outside current year.'

    return {
      row_id,
      simple_objective: '',
      complex_objective: '',
      status: 'INVALID',
      comments: reason,
      summary_reason: reason
    }
  }

  // ------------------------
  // 3) Temporary placeholder objective (will be replaced in later steps)
  // ------------------------
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
    let body: KpiRequest

    try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' })
    }
    
    if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request structure.' })
    }

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