// engine/constants.ts
// Canonical constants for KPI Engine v10.7.5 (Option C-FULL)
// Ensures predictable validation behavior and ordering across all modules.

// ------------------------------------------------------------
// Allowed enumerations
// ------------------------------------------------------------

export const ALLOWED_TASK_TYPES = [
  'Project',
  'Change Request',
  'Consultation',
] as const;

export const ALLOWED_TEAM_ROLES = [
  'Content',
  'Design',
  'Development',
  'Content Lead',
  'Design Lead',
  'Development Lead'
] as const;

// Lowercase lookups for case-insensitive matching
export const ALLOWED_TASK_TYPES_LOWER = ALLOWED_TASK_TYPES.map(t => t.toLowerCase());
export const ALLOWED_TEAM_ROLES_LOWER = ALLOWED_TEAM_ROLES.map(r => r.toLowerCase());

export type AllowedTaskType = (typeof ALLOWED_TASK_TYPES)[number];
export type AllowedTeamRole = (typeof ALLOWED_TEAM_ROLES)[number];

type MetricDefaults = {
  output: string;
  quality: string;
  improvement: string;
};

export type RoleDefaultKey = 'content' | 'design' | 'development' | 'generic';

// ------------------------------------------------------------
// Mandatory fields ordering (canonical for error messages)
// ------------------------------------------------------------

export const MANDATORY_FIELD_ORDER = [
  'Task Name',
  'Task Type',
  'Team Role',
  'Deadline',
  'Strategic Benefit'
];

// ------------------------------------------------------------
// Invalid value fields ordering (canonical)
// ------------------------------------------------------------

export const INVALID_VALUE_ORDER = [
  'Task Type',
  'Team Role',
  'Mode'
];

// ------------------------------------------------------------
// Invalid text fields ordering (canonical)
// ------------------------------------------------------------

export const INVALID_TEXT_ORDER = [
  'Company',
  'Strategic Benefit',
  'Output',
  'Quality',
  'Improvement'
];

// ------------------------------------------------------------
// Year rules
// ------------------------------------------------------------

export function getCurrentEngineYear(): number {
  // v10.7.5 rule: only deadlines in current calendar year are accepted
  return new Date().getFullYear();
}

// ------------------------------------------------------------
// Company rules
// ------------------------------------------------------------

// Company field is optional, but must not contain:
// - HTML / SQL / JS / scripts
// - Low-semantic noise
// - Encoded structures

// Companies like "telecomEgypt", "ACME Ltd", "WeConnect" should be treated as valid proper nouns.
// Detection of dangerous content is handled in validateDangerous.ts.

// ------------------------------------------------------------
// Placeholder metric defaults (moved to metricsAutoSuggest.ts)
// ------------------------------------------------------------
// These will be enriched in v10.8 with role_metric_matrix mapping.

export const ROLE_DEFAULT_METRICS: Readonly<Record<RoleDefaultKey, MetricDefaults>> = {
  content: {
    output: 'Publish 95% of planned content on time',
    quality: 'Keep content error rate below 2%',
    improvement: 'Increase content engagement by 15%'
  },
  design: {
    output: 'Maintain ≥95% adherence to the design system',
    quality: 'Ensure WCAG AA accessibility compliance',
    improvement: 'Increase task success rate in key flows by 15%'
  },
  development: {
    output: 'Reduce critical defects by 30% in the target scope',
    quality: 'Maintain 99.9% service uptime on impacted systems',
    improvement: 'Increase performance scores by 20% on key journeys'
  },
  generic: {
    output: 'Deliver agreed scope within the planned timeline',
    quality: 'Meet acceptance criteria with ≤5% defect rate',
    improvement: 'Improve customer satisfaction by 10%'
  }
} as const;