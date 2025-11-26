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

const ALLOWED_TASK_TYPES = [
  'Project',
  'Change Request',
  'Consultation',
  'Maintenance'
]

const ALLOWED_TEAM_ROLES = [
  'Content',
  'Design',
  'Development',
  'Content Lead',
  'Design Lead',
  'Development Lead'
]

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
  // 1) Validate mandatory fields (presence + semantic) AND deadline
  // ------------------------
  const missingFields: string[] = []
  const invalidFields: string[] = []

  const safeTaskName = (task_name ?? '').toString().trim()
  const safeTaskType = (task_type ?? '').toString().trim()
  const safeTeamRole = (team_role ?? '').toString().trim()
  const safeDeadline = (dead_line ?? '').toString().trim()
  const safeStrategicBenefit = (strategic_benefit ?? '').toString().trim()

  // Task Name
  if (!safeTaskName) {
    missingFields.push('Task Name')
  }

  // Task Type: missing vs invalid (case‑insensitive normalization)
  let normalizedTaskType = safeTaskType.toLowerCase();
  const allowedTaskTypesLower = ALLOWED_TASK_TYPES.map(t => t.toLowerCase());

  if (!safeTaskType) {
    missingFields.push('Task Type');
  } else if (!allowedTaskTypesLower.includes(normalizedTaskType)) {
    invalidFields.push('Task Type');
  } else {
    // Normalize to canonical form (title case from ALLOWED_TASK_TYPES)
    const idx = allowedTaskTypesLower.indexOf(normalizedTaskType);
    row.task_type = ALLOWED_TASK_TYPES[idx];
  }

  // Team Role: missing vs invalid (case‑insensitive normalization)
  const rawTeamRole = safeTeamRole.split('–')[0].trim();
  let normalizedTeamRole = rawTeamRole.toLowerCase();
  const allowedTeamRolesLower = ALLOWED_TEAM_ROLES.map(r => r.toLowerCase());

  if (!rawTeamRole) {
    missingFields.push('Team Role');
  } else if (!allowedTeamRolesLower.includes(normalizedTeamRole)) {
    invalidFields.push('Team Role');
  } else {
    // Normalize to canonical form
    const idx = allowedTeamRolesLower.indexOf(normalizedTeamRole);
    row.team_role = ALLOWED_TEAM_ROLES[idx];
  }

  // Strategic Benefit
  if (!safeStrategicBenefit) {
    missingFields.push('Strategic Benefit')
  }

  // ------------------------
  // Deadline validation (flexible multi-format parsing)
  // ------------------------
  let deadlineInvalidFormat = false
  let deadlineWrongYear = false

  if (!safeDeadline) {
    missingFields.push('Deadline')
  } else {
    const deadlineStr = safeDeadline
    let parsedDate: Date | null = null

    // Try ISO: YYYY-MM-DD
    const isoRegex = /^\d{4}-\d{2}-\d{2}$/
    if (isoRegex.test(deadlineStr)) {
      parsedDate = new Date(deadlineStr)
    }

    // Try Slash: YYYY/MM/DD
    const slashRegex = /^\d{4}\/\d{2}\/\d{2}$/
    if (!parsedDate && slashRegex.test(deadlineStr)) {
      const normalized = deadlineStr.replace(/\//g, '-')
      parsedDate = new Date(normalized)
    }

    // Try Egyptian/European format: DD/MM/YYYY
    const ddmmyyyyRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!parsedDate && ddmmyyyyRegex.test(deadlineStr)) {
      // Convert DD/MM/YYYY → YYYY-MM-DD
      const [dd, mm, yyyy] = deadlineStr.split('/');
      const normalized = `${yyyy}-${mm}-${dd}`;
      parsedDate = new Date(normalized);
    }

    // Try Dot: YYYY.MM.DD
    const dotRegex = /^\d{4}\.\d{2}\.\d{2}$/
    if (!parsedDate && dotRegex.test(deadlineStr)) {
      const normalized = deadlineStr.replace(/\./g, '-')
      parsedDate = new Date(normalized)
    }

    // Try Text month: YYYY-MMM-DD (e.g., 2025-Sep-30) or YYYY-MMMM-DD
    const textMonthRegex = /^\d{4}-[A-Za-z]{3,9}-\d{2}$/
    if (!parsedDate && textMonthRegex.test(deadlineStr)) {
      parsedDate = new Date(deadlineStr)
    }

    // Try space-separated text month: YYYY MMM DD (2025 Sep 30)
    const spaceTextRegex = /^\d{4} [A-Za-z]{3,9} \d{2}$/
    if (!parsedDate && spaceTextRegex.test(deadlineStr)) {
      parsedDate = new Date(deadlineStr)
    }

    // Final validation: if still null or invalid date → invalid format
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      deadlineInvalidFormat = true
    } else {
      // Format OK → check year
      const year = parsedDate.getFullYear()
      const currentYear = new Date().getFullYear()
      if (year !== currentYear) {
        deadlineWrongYear = true
      }
    }
  }

  // ------------------------
  // Build failure output (missing + invalid + deadline)
  // ------------------------
  if (
    missingFields.length > 0 ||
    invalidFields.length > 0 ||
    deadlineInvalidFormat ||
    deadlineWrongYear
  ) {
    const parts: string[] = []

    // Sort fields into a canonical order for consistent messaging
    const FIELD_ORDER = [
      'Task Name',
      'Task Type',
      'Team Role',
      'Deadline',
      'Strategic Benefit'
    ]

    const INVALID_ORDER = [
      'Task Type',
      'Team Role'
    ]

    if (missingFields.length > 0) {
      missingFields.sort((a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))
      parts.push(`Missing mandatory field(s): ${missingFields.join(', ')}.`)
    }

    if (invalidFields.length > 0) {
      invalidFields.sort((a, b) => INVALID_ORDER.indexOf(a) - INVALID_ORDER.indexOf(b))
      parts.push(`Invalid value(s) for: ${invalidFields.join(', ')}.`)
    }

    if (deadlineInvalidFormat) {
      parts.push('Invalid deadline format.')
    }

    if (deadlineWrongYear) {
      parts.push('Deadline outside valid calendar year.')
    }

    // Explicitly state that objectives are not generated when validation fails
    parts.push('Objectives not generated due to validation errors.')

    const reason = parts.join('\n').trim()

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