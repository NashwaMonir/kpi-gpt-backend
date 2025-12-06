// api/kpi.ts
// SMART KPI Engine HTTP entrypoint (v10.7.5, Option C-FULL)
//
// Responsibilities:
//  - Handle HTTP method + JSON parsing
//  - Apply transport-level validation
//  - For each row:
//      * Run domain validation
//      * Run metrics auto-suggest (role/task matrix + defaults)
//      * Build final status + comments + summary_reason
//      * (v10.7.5) Leave objectives empty (GPT owns sentence generation)
//  - Return KpiResponse with error_codes per row
//
// This file contains NO business rules itself; it only orchestrates engine modules.

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { ErrorCodes, type ErrorCode } from '../engine/errorCodes';
import type { KpiRequest, KpiResponse, KpiRowOut } from '../engine/types';
import { validateKpiTransport } from '../engine/validateTransport';
import { validateDomain } from '../engine/validateDomain';
import { resolveMetrics } from '../engine/metricsAutoSuggest';
import { buildFinalMessage } from '../engine/buildErrorMessage';
import { computeVariationSeed } from '../engine/variationSeed';

// Simple in-memory metrics for KPI Engine endpoint
let kpiRequestsTotal = 0;
let kpiRequests400 = 0;
let kpiRequests500 = 0;

const MAX_KPI_BODY_BYTES = 200_000; // ~200 KB hard limit for KPI JSON body
const MAX_KPI_ROWS = 1000;          // hard upper bound for rows per request

// Lightweight structured logging helpers (console-based)
function logKpiInfo(event: string, ctx: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      level: 'info',
      service: 'kpi-engine',
      event,
      ...ctx
    })
  );
}

function logKpiWarn(event: string, ctx: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'kpi-engine',
      event,
      ...ctx
    })
  );
}

function logKpiError(event: string, ctx: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'kpi-engine',
      event,
      ...ctx
    })
  );
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    kpiRequests400++;
    logKpiWarn('method_not_allowed', {
      method: req.method
    });
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Count every POST KPI request
  kpiRequestsTotal++;

  let body: KpiRequest;

  // Optional strict body-size guard, independent of Vercel platform limits
  const rawBody = req.body as any;
  let approxSize = 0;

  if (typeof rawBody === 'string') {
    approxSize = rawBody.length;
  } else if (rawBody != null) {
    try {
      approxSize = JSON.stringify(rawBody).length;
    } catch {
      approxSize = 0;
    }
  }

  if (approxSize > MAX_KPI_BODY_BYTES) {
    kpiRequests400++;
    logKpiWarn('request_body_too_large', {
      approx_size: approxSize,
      max_bytes: MAX_KPI_BODY_BYTES
    });
    return res.status(413).json({
      error: 'Request body too large for KPI engine.',
      error_codes: [ErrorCodes.INVALID_REQUEST_STRUCTURE as ErrorCode]
    });
  }

  try {
    // --------------------------------------
    // 1. Parse JSON safely
    // --------------------------------------
    try {
      body =
        typeof req.body === 'string'
          ? JSON.parse(req.body)
          : (req.body as KpiRequest);
    } catch {
      // JSON parsing error is transport-level
      kpiRequests400++;
      logKpiWarn('invalid_json_body', {
        method: req.method
      });
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
      const status = transportCheck.errorStatus ?? 400;
      if (status >= 500) {
        kpiRequests500++;
        logKpiError('transport_validation_failed_5xx', {
          status,
          error_body: transportCheck.errorBody ?? null
        });
      } else {
        kpiRequests400++;
        logKpiWarn('transport_validation_failed_4xx', {
          status,
          error_body: transportCheck.errorBody ?? null
        });
      }

      return res
        .status(status)
        .json(
          transportCheck.errorBody ?? {
            error: 'Invalid request structure.',
            error_codes: [ErrorCodes.INVALID_REQUEST_STRUCTURE as ErrorCode]
          }
        );
    }

    // At this point, body.rows is a valid array.
    const rowsIn = body.rows;

    if (rowsIn.length > MAX_KPI_ROWS) {
      kpiRequests400++;
      logKpiWarn('too_many_rows', {
        rows_count: rowsIn.length,
        max_rows: MAX_KPI_ROWS
      });
      return res.status(400).json({
        error: 'Too many rows in KPI request.',
        error_codes: [ErrorCodes.INVALID_REQUEST_STRUCTURE as ErrorCode]
      });
    }

    // Optional logging for engine_version / default_company (used by GPT, not backend)
    if (!body.engine_version) {
      logKpiWarn('engine_version_missing', {});
    }
    if (
      body.default_company !== undefined &&
      typeof body.default_company !== 'string'
    ) {
      logKpiWarn('default_company_non_string', {
        type: typeof body.default_company
      });
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
      const final = buildFinalMessage(domainResult, metricsResult, variationSeed, errorCodes);

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
        error_codes: final.errorCodes,
        // Expose resolved metrics snapshot to GPT; omit if null
        resolved_metrics: final.resolved_metrics ?? undefined
      };

      return rowOut;
    });

    const response: KpiResponse = { rows: rowsOut };

    // Compute a tiny status distribution for logging
    const statusCounts = rowsOut.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    logKpiInfo('kpi_request_completed_200', {
      rows_count: rowsOut.length,
      status_counts: statusCounts,
      engine_version: body.engine_version ?? 'v10.7.5'
    });

    // --------------------------------------
    // 4. Return 200 OK with structured response
    // --------------------------------------
    return res.status(200).json(response);
  } catch (err) {
    // Unexpected engine-level error
    kpiRequests500++;
    logKpiError('kpi_engine_unhandled_exception', {
      message: err instanceof Error ? err.message : String(err)
    });

    return res.status(500).json({
      error: 'Internal KPI engine error.',
      error_codes: [ErrorCodes.INTERNAL_ENGINE_ERROR as ErrorCode].filter(
        Boolean
      )
    });
  }
}