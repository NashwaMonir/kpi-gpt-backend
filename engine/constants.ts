// engine/constants.ts
// Canonical constants for KPI Engine v10.7.5 (Option C-FULL)
// Ensures predictable validation behavior and ordering across all modules.

import { DEFAULT_TENANT_CONFIG } from './config';
// ------------------------------------------------------------
// Allowed enumerations
// ------------------------------------------------------------


export const ALLOWED_TASK_TYPES = DEFAULT_TENANT_CONFIG.domain.allowedTaskTypes;
export const ALLOWED_TASK_TYPES_LOWER = ALLOWED_TASK_TYPES.map(t =>
  t.toLowerCase()
);

export const ALLOWED_TEAM_ROLES = DEFAULT_TENANT_CONFIG.domain.allowedTeamRoles;
export const ALLOWED_TEAM_ROLES_LOWER = ALLOWED_TEAM_ROLES.map(r =>
  r.toLowerCase()
);

export const GENERIC_COMPANY_TOKENS =
  DEFAULT_TENANT_CONFIG.domain.genericCompanyTokens;

export const ALLOWED_TEAM_ROLE_PREFIXES = [
  'content',
  'design',
  'development'
] as const;


export const COMPANY_SUFFIX_TOKENS = [
  'bank',
  'group',
  'telecom',
  'corp',
  'corporation',
  'ltd',
  'llc',
  'ab',
  'inc',
];

export type TeamRoleFamily = (typeof ALLOWED_TEAM_ROLE_PREFIXES)[number];

// Lowercase lookups for case-insensitive matching
/*export const ALLOWED_TASK_TYPES_LOWER = ALLOWED_TASK_TYPES.map(t => t.toLowerCase());


export const ALLOWED_TEAM_ROLES_LOWER = ALLOWED_TEAM_ROLES.map(r => r.toLowerCase());
*/
export type AllowedTaskType = (typeof ALLOWED_TASK_TYPES)[number];
export type AllowedTeamRole = (typeof ALLOWED_TEAM_ROLES)[number];

type MetricDefaults = {
  output: string;
  quality: string;
  improvement: string;
};
// -------------------------------------------------------
// LOW-SIGNAL / NON-SEMANTIC DETECTION CONSTANTS
// -------------------------------------------------------

// Emoji-only or contains no alphanumeric characters
export const REGEX_NO_ALPHANUMERIC = /[^A-Za-z0-9]/g;

// Punctuation-only strings (one or more punctuation characters)
export const REGEX_PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

// Detect sequences like "and and and", "och och och", "the the the"
export const STOPWORD_REPEAT_CANDIDATES = [
  'and',
  'or',
  'the',
  'och',
  'eller',
  'det',
  'den'
];

// Max length for a low-signal repeated stopword
export const LOW_SIGNAL_WORD_MAX_LENGTH = 4;

// ------------------------------------------------------------
// Length limit + shared patterns
// ------------------------------------------------------------


// 1) Maximum allowed length for any free-text field we validate
export const MAX_TEXT_LENGTH = 1000; // safe default; adjust if needed

// 2) Maximum number of distinct company tokens per cell
export const MAX_COMPANY_TOKENS = 20;

// 3) Maximum number of rows for preflight requests
export const MAX_PREFLIGHT_ROWS = 500;

// If you want to keep the older name:
export const DEFAULT_COMPANY_TOKEN_PATTERNS = GENERIC_COMPANY_TOKENS;

/*export const DEFAULT_COMPANY_TOKEN_PATTERNS: string[] = [
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
  'organization'
];*/

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
// ----------------------------------------------
// v10.7.5 / v10.8-ready ROLE DEFAULT METRICS
// ----------------------------------------------
export type RoleDefaultKey =
  | 'content'
  | 'content_lead'
  | 'design'
  | 'design_lead'
  | 'development'
  | 'development_lead'
  | 'generic';

export const ROLE_DEFAULT_METRICS: Readonly<Record<RoleDefaultKey, {
  output: string;
  quality: string;
  improvement: string;
}>> = {
  content: {
    output: 'Publish 95% of planned content on time',
    quality: 'Keep content error rate below 2%',
    improvement: 'Increase content engagement by 15%'
  },

  content_lead: {
    output: 'Ensure editorial roadmap delivery (100% on time)',
    quality: 'Maintain cross-channel consistency and tone of voice',
    improvement: 'Improve audience engagement by 20%'
  },

  design: {
    output: 'Maintain ≥95% adherence to the design system',
    quality: 'Ensure WCAG AA accessibility compliance',
    improvement: 'Increase task success rate by 15%'
  },

  design_lead: {
    output: 'Drive end-to-end design consistency across all products',
    quality: 'Lead accessibility governance (WCAG AA+)',
    improvement: 'Increase design system adoption by 25%'
  },

  development: {
    output: 'Reduce critical defects by 30%',
    quality: 'Maintain 99.9% uptime',
    improvement: 'Improve performance scores by 20%'
  },

  development_lead: {
    output: 'Ensure technical delivery excellence across squads',
    quality: 'Maintain engineering quality thresholds across products',
    improvement: 'Improve deployment success rate by 25%'
  },

  generic: {
    output: 'Deliver agreed scope within planned timeline',
    quality: 'Meet acceptance criteria with ≤5% defect rate',
    improvement: 'Improve customer satisfaction by 10%'
  }
} as const;