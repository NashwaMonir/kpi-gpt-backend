// api/kpi.ts
// SMART KPI Engine HTTP entrypoint (v10.7.5, Option C-FULL)
//
// Responsibilities:
//  - Handle HTTP method + JSON parsing
//  - Apply transport-level validation
//  - For each row:
//      * Run domain validation
//      * Run metrics auto-suggest
//      * Build final status + comments + summary_reason
//      * (v10.7.5) Leave objectives empty (GPT owns sentence generation)
//  - Return KpiResponse with error_codes per row
//
// This file contains NO business rules itself; it only orchestrates engine modules.
import { ErrorCodes, type ErrorCode } from '../engine/errorCodes';

import type { VercelRequest, VercelResponse } from '@vercel/node';

import type { KpiRequest, KpiResponse, KpiRowOut } from '../engine/types';

import { validateKpiTransport } from '../engine/validateTransport';
import { validateDomain } from '../engine/validateDomain';
import { resolveMetrics } from '../engine/metricsAutoSuggest';
import { buildFinalMessage } from '../engine/buildErrorMessage';


export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body: KpiRequest;

  // --------------------------------------
  // 1. Parse JSON safely
  // --------------------------------------
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as KpiRequest);
  } catch {
    // JSON parsing error is transport-level
    return res.status(400).json({
      error: 'Invalid JSON body.',
      error_codes: [ErrorCodes.INVALID_JSON_BODY as ErrorCode]
    });
  }

  // --------------------------------------
  // 2. Transport-level validation
  // --------------------------------------
  const transportCheck = validateKpiTransport(body);

  if (!transportCheck.ok) {
    return res
      .status(transportCheck.errorStatus ?? 400)
      .json(
        transportCheck.errorBody ?? {
          error: 'Invalid request structure.',
          error_codes: [ErrorCodes.INVALID_REQUEST_STRUCTURE as ErrorCode]
        }
      );
  }

  // At this point, body.rows is a valid array.
  const rowsIn = body.rows;

  // Optional logging for engine_version / default_company (used by GPT, not backend)
  if (!body.engine_version) {
    console.warn(
      'Warning: engine_version missing; proceeding with default v10.7.5 semantics.'
    );
  }
  if (body.default_company !== undefined && typeof body.default_company !== 'string') {
    console.warn(
      'Warning: default_company should be a string; received type:',
      typeof body.default_company
    );
  }

  // --------------------------------------
  // 3. Per-row processing
  // --------------------------------------
  const rowsOut: KpiRowOut[] = rowsIn.map((rowIn) => {
    const errorCodes: ErrorCode[] = [];

    // 3.1 Domain validation (structure, fields, deadline, dangerous text, etc.)
    const domainResult = validateDomain(rowIn, errorCodes);

    // 3.2 Metrics auto-suggest logic (may mark NEEDS_REVIEW)
    const metricsResult = resolveMetrics(domainResult.normalizedRow, errorCodes);

    // 3.3 Build final status + comments + summary_reason
    const final = buildFinalMessage(domainResult, metricsResult, errorCodes);

    // 3.4 Assemble KpiRowOut (objectives still placeholders in v10.7.5)
    const simple_objective = '';
    const complex_objective = '';

    const rowOut: KpiRowOut = {
      row_id: domainResult.normalizedRow.row_id,
      simple_objective,
      complex_objective,
      status: final.status,
      comments: final.comments,
      summary_reason: final.summary_reason,
      error_codes: final.errorCodes
    };

    return rowOut;
  });

  const response: KpiResponse = { rows: rowsOut };

  // --------------------------------------
  // 4. Return 200 OK with structured response
  // --------------------------------------
  return res.status(200).json(response);
}