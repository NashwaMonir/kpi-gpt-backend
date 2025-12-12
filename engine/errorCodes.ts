// engine/errorCodes.ts
// Canonical error codes for the KPI Engine (v10.7.5, Option C-FULL)
//
// Code ranges follow the v10.7.5 specs:
//
//  E200–E299 → Missing mandatory fields
//  E300–E399 → Invalid formats / values (task type, team role, deadline, mode)
//  E400–E499 → Dangerous / rejected content and low-signal text
//  E500–E599 → Metrics auto-suggest (NEEDS_REVIEW only)
//  E600–E699 → JSON / structural issues (transport and type-level)

// NOTE (v10.8):
// - E2xx / E3xx / E4xx codes always result in INVALID.
// - E5xx codes (metrics auto-suggest) always result in NEEDS_REVIEW, never INVALID.
// - Error codes are additive; final status is derived by the engine, not by presence of a single code.

export const ErrorCodes = {
  // 2xx – Missing mandatory fields (07_Domain_Validation_Spec §3)
  MISSING_TASK_NAME: 'E201',
  MISSING_TASK_TYPE: 'E202',
  MISSING_TEAM_ROLE: 'E203',
  MISSING_DEADLINE: 'E204',
  MISSING_STRATEGIC_BENEFIT: 'E205',

  // 3xx – Invalid enum / value / deadline / mode
  // (06_System_error_spec §4, 07_Domain_Validation_Spec §§4–7, 14_Backend_Reference §4)
  INVALID_TASK_TYPE: 'E301',
  INVALID_TEAM_ROLE: 'E302',
  DEADLINE_WRONG_YEAR: 'E303',
  DEADLINE_INVALID_FORMAT: 'E304',
  DEADLINE_TEXTUAL_NONDATE: 'E305',
  INVALID_MODE_VALUE: 'E306',

  // 4xx – Dangerous / rejected content (10_Sanitization_and_Security_Spec §§3,8)
  // E401–E405 are category-level codes, not per-field codes.
  DANGEROUS_TEXT: 'E401',      // HTML, JS, SQL, shell, dangerous Unicode, etc.
  LOW_SIGNAL_TEXT: 'E402',     // Non-business / noisy payload (emoji spam, garbage)
  FORBIDDEN_CHARS: 'E403',     // Reserved for future allowed-character rules
  CORRUPTED_TEXT: 'E404',      // Unrecognized structure / corrupted text
  RESERVED_TEXT_RULE: 'E405',  // Reserved for v10.8 parsing extensions

  // 5xx – Metrics auto-suggest (NEEDS_REVIEW, never INVALID)
  // (08_Metrics_AutoSuggest_Spec §4, 14_Backend_Reference §4.6)
  METRICS_AUTOSUGGEST_ALL: 'E501',      // All Output/Quality/Improvement missing
  METRICS_AUTOSUGGEST_PARTIAL: 'E502',  // One or two metrics missing

  // 6xx – JSON / structural issues (06_System_error_spec §7, 07_Domain_Validation_Spec §9)
  INVALID_JSON_BODY: 'E601',              // JSON parse failed in api/kpi.ts
  INVALID_REQUEST_STRUCTURE: 'E602',      // body is null / not an object
  INVALID_ROWS_ARRAY: 'E603',             // rows missing or not an array
  EMPTY_ROWS_ARRAY: 'E604',               // rows is [], not allowed
  INVALID_TRANSPORT_PAYLOAD: 'E605',      // a row is not a plain object
  INVALID_TRANSPORT_SANITIZATION: 'E606', // script/template injection in body
  INTERNAL_ENGINE_ERROR: 'E607',

} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];


// Optional human-readable descriptions (for logs / future UI)
export const ErrorCodeDescriptions: Record<ErrorCode, string> = {
  [ErrorCodes.MISSING_TASK_NAME]: 'Task Name is missing.',
  [ErrorCodes.MISSING_TASK_TYPE]: 'Task Type is missing.',
  [ErrorCodes.MISSING_TEAM_ROLE]: 'Team Role is missing.',
  [ErrorCodes.MISSING_DEADLINE]: 'Deadline is missing.',
  [ErrorCodes.MISSING_STRATEGIC_BENEFIT]: 'Strategic Benefit is missing.',

  [ErrorCodes.INVALID_TASK_TYPE]: 'Task Type value is not allowed.',
  [ErrorCodes.INVALID_TEAM_ROLE]: 'Team Role value is not allowed.',
  [ErrorCodes.DEADLINE_WRONG_YEAR]: 'Deadline year is outside the current calendar year.',
  [ErrorCodes.DEADLINE_INVALID_FORMAT]: 'Deadline is not in a supported date format.',
  [ErrorCodes.DEADLINE_TEXTUAL_NONDATE]: 'Deadline contains non-parsable or textual content.',
  [ErrorCodes.INVALID_MODE_VALUE]: 'Mode value is not supported and was normalized to "both".',

  [ErrorCodes.DANGEROUS_TEXT]: 'Field contains dangerous or injection-like content.',
  [ErrorCodes.LOW_SIGNAL_TEXT]: 'Field contains low-signal or non-business text.',
  [ErrorCodes.FORBIDDEN_CHARS]: 'Field contains forbidden or deprecated characters.',
  [ErrorCodes.CORRUPTED_TEXT]: 'Field contains corrupted or unrecognized structure.',
  [ErrorCodes.RESERVED_TEXT_RULE]: 'Reserved text rule (v10.8 extension).',

  [ErrorCodes.METRICS_AUTOSUGGEST_ALL]: 'All three metrics were auto-suggested.',
  [ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL]: 'One or more metrics were auto-suggested.',

  [ErrorCodes.INVALID_JSON_BODY]: 'Request body is not valid JSON.',
  [ErrorCodes.INVALID_REQUEST_STRUCTURE]: 'Request structure is invalid or not a non-null object.',
  [ErrorCodes.INVALID_ROWS_ARRAY]: 'The "rows" property is missing or is not a valid array.',
  [ErrorCodes.EMPTY_ROWS_ARRAY]: 'The "rows" array is present but empty.',
  [ErrorCodes.INVALID_TRANSPORT_PAYLOAD]: 'One or more rows are not valid objects.',
  [ErrorCodes.INVALID_TRANSPORT_SANITIZATION]: 'Request contains unsafe or non-JSON-safe characters.',
  [ErrorCodes.INTERNAL_ENGINE_ERROR]: 'Internal backend processing failure.',
};

export const ERROR_COMMENTS: Record<ErrorCode, string> = {
  [ErrorCodes.MISSING_TASK_NAME]: 'Missing mandatory field(s): Task Name.',
  [ErrorCodes.MISSING_TASK_TYPE]: 'Missing mandatory field(s): Task Type.',
  [ErrorCodes.MISSING_TEAM_ROLE]: 'Missing mandatory field(s): Team Role.',
  [ErrorCodes.MISSING_DEADLINE]: 'Missing mandatory field(s): Deadline.',
  [ErrorCodes.MISSING_STRATEGIC_BENEFIT]: 'Missing mandatory field(s): Strategic Benefit.',

  [ErrorCodes.INVALID_TASK_TYPE]: 'Invalid value(s) for: Task Type.',
  [ErrorCodes.INVALID_TEAM_ROLE]: 'Invalid value(s) for: Team Role.',
  [ErrorCodes.DEADLINE_WRONG_YEAR]: 'Deadline outside the allowed calendar year.',
  [ErrorCodes.DEADLINE_INVALID_FORMAT]: 'Invalid deadline format.',
  [ErrorCodes.DEADLINE_TEXTUAL_NONDATE]: 'Deadline contains non-parsable or textual content.',
  [ErrorCodes.INVALID_MODE_VALUE]: 'Invalid mode value detected; backend fallback applied.',

  [ErrorCodes.DANGEROUS_TEXT]: 'Invalid text format for field (dangerous content).',
  [ErrorCodes.LOW_SIGNAL_TEXT]: 'Invalid text format for field (low semantic signal).',
  [ErrorCodes.FORBIDDEN_CHARS]: 'Invalid text format for field (forbidden characters).',
  [ErrorCodes.CORRUPTED_TEXT]: 'Invalid text format for field (corrupted/unrecognized).',
  [ErrorCodes.RESERVED_TEXT_RULE]: 'Invalid text format due to reserved parsing rule.',

  [ErrorCodes.METRICS_AUTOSUGGEST_ALL]: 'Metrics auto-suggested (Output, Quality, Improvement).',
  [ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL]: 'Metrics auto-suggested (one or more missing).',

  [ErrorCodes.INVALID_JSON_BODY]: 'Invalid JSON body.',
  [ErrorCodes.INVALID_REQUEST_STRUCTURE]: 'Invalid request structure.',
  [ErrorCodes.INVALID_ROWS_ARRAY]: 'Missing or invalid rows array.',
  [ErrorCodes.EMPTY_ROWS_ARRAY]: 'Rows array must not be empty.',
  [ErrorCodes.INVALID_TRANSPORT_PAYLOAD]: 'Row entries must be objects.',
  [ErrorCodes.INVALID_TRANSPORT_SANITIZATION]: 'Request contains unsafe or non-JSON-safe characters.',
  [ErrorCodes.INTERNAL_ENGINE_ERROR]: 'Internal KPI engine error.',
};

// Helper: add an error code only once, preserving insertion order
export function addErrorCode(list: ErrorCode[], code: ErrorCode): void {
  if (!list.includes(code)) {
    list.push(code);
  }
}

export type ValidationStatus = 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
