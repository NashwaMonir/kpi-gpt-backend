// engine/validateTransport.ts
// Transport-level validation for KPI Engine v10.7.5 (Option C-FULL)
//
// Responsibilities:
//  - Validate the top-level request structure for /api/kpi
//  - Ensure "rows" exists, is an array, is non-empty, and every entry is an object
//  - Do NOT perform domain logic (roles, metrics, deadlines, etc.)
//
// This file follows strict API best practices (Google / Stripe / AWS style):

import { ErrorCodes } from './errorCodes';
import type { KpiRequest } from './types';


export interface TransportValidationResult {
  ok: boolean;
  errorStatus?: number;
  errorBody?: {
    error: string;
    error_codes?: string[];
  };
}

/**
 * Transport-level validation for KPI requests.
 *
 * NOTE:
 *  - JSON parsing is handled earlier in api/kpi.ts
 *  - This function operates on already parsed JSON
 */
export function validateKpiTransport(body: unknown): TransportValidationResult {
  // -----------------------------------------
  // 1) Validate top-level JSON object shape
  // -----------------------------------------
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      errorStatus: 400,
      errorBody: {
        error: 'Invalid request structure.',
        error_codes: [ErrorCodes.INVALID_REQUEST_STRUCTURE] // E602
      }
    };
  }

  const typed = body as Partial<KpiRequest>;

  // -----------------------------------------
  // 2) Validate rows[] existence & type
  // -----------------------------------------
  if (!Array.isArray(typed.rows)) {
    return {
      ok: false,
      errorStatus: 400,
      errorBody: {
        error: 'Missing or invalid rows array.',
        error_codes: [ErrorCodes.INVALID_ROWS_ARRAY] // E603
      }
    };
  }

  // -----------------------------------------
  // 3) rows[] MUST NOT be empty
  // -----------------------------------------
  if (typed.rows.length === 0) {
    return {
      ok: false,
      errorStatus: 400,
      errorBody: {
        error: 'Rows array must not be empty.',
        error_codes: [ErrorCodes.EMPTY_ROWS_ARRAY] // E604
      }
    };
  }

  // -----------------------------------------
  // 4) Validate each row is a plain object
  // -----------------------------------------
  for (const r of typed.rows) {
    const invalid =
      typeof r !== 'object' ||
      r === null ||
      Array.isArray(r);

    if (invalid) {
      return {
        ok: false,
        errorStatus: 400,
        errorBody: {
        error: 'Row entries must be objects.',
        error_codes: [ErrorCodes.INVALID_TRANSPORT_PAYLOAD] // E605
        }
      };
    }
  }

  // -----------------------------------------
  // 5) Passed transport-level validation
  // -----------------------------------------
  return { ok: true };
}