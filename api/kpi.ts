// api/kpi.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

// --------- Types matching the GPT Action schema --------

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
// -------- Default metrics by role (v10.7.5 skeleton) --------

function getRoleMetricDefaults(team_role: string | undefined) {
  const role = (team_role || '').toLowerCase()

  if (role.includes('content')) {
    return {
      output: 'Publish 95% of planned content on time',
      quality: 'Keep content error rate below 2%',
      improvement: 'Increase content engagement by 15%'
    }
  }

  if (role.includes('design')) {
    return {
      output: 'Maintain ≥95% adherence to the design system',
      quality: 'Ensure WCAG AA accessibility compliance',
      improvement: 'Increase task success rate in key flows by 15%'
    }
  }

  if (role.includes('development')) {
    return {
      output: 'Reduce critical defects by 30% in the target scope',
      quality: 'Maintain 99.9% service uptime on impacted systems',
      improvement: 'Increase performance scores by 20% on key journeys'
    }
  }

  // Generic fallback
  return {
    output: 'Deliver agreed scope within the planned timeline',
    quality: 'Meet acceptance criteria with ≤5% defect rate',
    improvement: 'Improve customer satisfaction by 10%'
  }
}

// --------  fields Validation --------
function processRow(row: KpiRowIn): KpiRowOut {
    const {
    row_id,
    task_name,
    team_role,
    task_type,
    dead_line,
    strategic_benefit,
    output_metric: inputOutput,
    quality_metric: inputQuality,
    improvement_metric: inputImprovement,
    mode
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
  // 3) Metrics logic (auto-suggest from Role Metric Matrix skeleton)
  // ------------------------
  const defaults = getRoleMetricDefaults(team_role)

  let output_metric = inputOutput
  let quality_metric = inputQuality
  let improvement_metric = inputImprovement

  const autoSuggestedFields: string[] = []

  if (!output_metric || !String(output_metric).trim()) {
    output_metric = defaults.output
    autoSuggestedFields.push('Output')
  }
  if (!quality_metric || !String(quality_metric).trim()) {
    quality_metric = defaults.quality
    autoSuggestedFields.push('Quality')
  }
  if (!improvement_metric || !String(improvement_metric).trim()) {
    improvement_metric = defaults.improvement
    autoSuggestedFields.push('Improvement')
  }

  // Base status and comments for the skeleton engine
    let status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID' = 'VALID'
    let comments = 'All SMART criteria met.'
    let summary_reason = ''

    if (autoSuggestedFields.length === 3) {
    comments = 'Metrics auto-suggested (Output / Quality / Improvement).'
    summary_reason = 'Metrics auto-suggested (Output / Quality / Improvement).'
    status = 'NEEDS_REVIEW'
    } else if (autoSuggestedFields.length > 0) {
    const joined = autoSuggestedFields.join(' / ')
    comments = `Metrics auto-suggested for: ${joined}.`
    summary_reason = `Metrics auto-suggested for: ${joined}.`
    status = 'NEEDS_REVIEW'
    }

  // ------------------------
    // 4) Temporary objectives with mode handling
    // ------------------------

    // Base simple objective (we will make this smarter later)
    const simpleTemplate =
    `Deliver '${task_name}' for ${team_role} by ${dead_line} ` +
    `to support ${strategic_benefit}.`

    let simple_objective = ''
    let complex_objective = ''

    const normalizedMode: 'simple' | 'complex' | 'both' =
    mode === 'simple' || mode === 'complex' || mode === 'both' ? mode : 'both'

    // For now we only have a real simple objective
    if (normalizedMode === 'simple' || normalizedMode === 'both') {
    simple_objective = simpleTemplate
    }

    // Complex objective will be implemented later
    if (normalizedMode === 'complex' || normalizedMode === 'both') {
    complex_objective = ''
    }

    return {
    row_id,
    simple_objective,
    complex_objective,
    status,
    comments,
    summary_reason
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