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
// TODO v10.8:
// Replace hard-coded defaults with values loaded from role_metric_matrix.json
// so backend and GPT share the same matrix source of truth.

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
  // Normalize metric inputs to safe trimmed strings
  const safeOutput = (inputOutput ?? '').toString().trim()
  const safeQuality = (inputQuality ?? '').toString().trim()
  const safeImprovement = (inputImprovement ?? '').toString().trim()

  // Normalize mode to simple | complex | both (fallback = both)
  const rawMode = (mode || '').toString().toLowerCase().trim()
  const normalizedMode: 'simple' | 'complex' | 'both' =
  rawMode === 'simple' || rawMode === 'complex' || rawMode === 'both'
  ? (rawMode as 'simple' | 'complex' | 'both')
  : 'both'
  // Note: normalizedMode is not yet used by the backend (text generation is handled in GPT),
  // but this keeps backend behavior consistent with the v10.7.5 mode rules.

  // Optional: warn about unsupported mode values (for future debugging / v10.8).
  if (rawMode && !['simple', 'complex', 'both'].includes(rawMode)) {
  console.warn(`Unsupported mode '${rawMode}' for row_id=${row_id}; falling back to 'both'.`)
  }

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
    const reason = `Missing mandatory field(s): ${missingFields.join(', ')}.`

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
  const match = String(dead_line).match(/(\d{4})/)
  if (match) {
    deadlineYear = Number(match[1])
  }
} catch {
  deadlineYear = null
}

const currentYear = new Date().getFullYear()
if (!deadlineYear || deadlineYear !== currentYear) {
  const reason = 'Deadline outside valid calendar year.'

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

  let output_metric = safeOutput
  let quality_metric = safeQuality
  let improvement_metric = safeImprovement

  const autoSuggestedFields: string[] = []

  if (!output_metric) {
    output_metric = defaults.output
    autoSuggestedFields.push('Output')
  }
  if (!quality_metric) {
    quality_metric = defaults.quality
    autoSuggestedFields.push('Quality')
  }
  if (!improvement_metric) {
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
  // 4) Objectives (placeholders only in v10.7.5)
  // ------------------------

  const simple_objective = ''
  const complex_objective = ''

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

// Optional: warn if engine_version is missing (GPT should always send it).
if (!body.engine_version) {
  console.warn('Warning: engine_version missing; proceeding with default v10.7.5 semantics.')
}

// Optional: warn if default_company is not a string.
if (body.default_company !== undefined && typeof body.default_company !== 'string') {
  console.warn('Warning: default_company should be a string; received type:', typeof body.default_company)
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