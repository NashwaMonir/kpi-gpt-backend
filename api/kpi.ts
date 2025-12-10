// api/kpi.ts
// SMART KPI Engine HTTP entrypoint (v10.7.5, Option C-FULL)

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { ErrorCodes, type ErrorCode } from '../engine/errorCodes';
import type {
  KpiRequest,
  KpiResponse,
  KpiRowOut,
  ResolvedMetricsSnapshot,
  PreparedRow
} from '../engine/types';
import { validateKpiTransport } from '../engine/validateTransport';
import { validateDomain } from '../engine/validateDomain';
import { resolveMetrics } from '../engine/metricsAutoSuggest';
import { buildFinalMessage } from '../engine/buildErrorMessage';
import { computeVariationSeed } from '../engine/variationSeed';
import { buildObjectivesForRow } from '../engine/objectiveEngine';

// simple in-memory counters
let kpiRequestsTotal = 0;
let kpiRequests400 = 0;
let kpiRequests500 = 0;

const MAX_KPI_BODY_BYTES = 200_000;
const MAX_KPI_ROWS = 1000;

function logKpiInfo(event: string, ctx: Record<string, unknown>) {
  console.info(JSON.stringify({ level: 'info', service: 'kpi-engine', event, ...ctx }));
}
function logKpiWarn(event: string, ctx: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: 'warn', service: 'kpi-engine', event, ...ctx }));
}
function logKpiError(event: string, ctx: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', service: 'kpi-engine', event, ...ctx }));
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    kpiRequests400++;
    logKpiWarn('method_not_allowed', { method: req.method });
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  kpiRequestsTotal++;

  let body: KpiRequest;
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
    try {
      body =
        typeof req.body === 'string'
          ? JSON.parse(req.body)
          : (req.body as KpiRequest);
    } catch {
      kpiRequests400++;
      logKpiWarn('invalid_json_body', { method: req.method });
      return res.status(400).json({
        error: 'Invalid JSON body.',
        error_codes: [ErrorCodes.INVALID_JSON_BODY as ErrorCode]
      });
    }

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

    const rowsOut: KpiRowOut[] = rowsIn.map((rowIn) => {
      const errorCodes: ErrorCode[] = [];

      const domainResult = validateDomain(rowIn, errorCodes);
      const normalized = domainResult.normalizedRow;

      const variation_seed = computeVariationSeed(normalized);

      const metricsResult = resolveMetrics(normalized, variation_seed, errorCodes);

      const metricsAutoSuggested = metricsResult.used_default_metrics === true;

      const final = buildFinalMessage(domainResult, metricsResult, errorCodes);

      const resolvedMetrics: ResolvedMetricsSnapshot = {
        output_metric: final.metrics.output_metric ?? '',
        quality_metric: final.metrics.quality_metric ?? '',
        improvement_metric: final.metrics.improvement_metric ?? ''
      };

      const preparedRow: PreparedRow = {
        row_id: normalized.row_id,
        team_role: (normalized.team_role ?? '').toString(),
        task_type: (normalized.task_type ?? '').toString(),
        task_name: (normalized.task_name ?? '').toString(),
        dead_line: (normalized.dead_line ?? '').toString(),
        strategic_benefit: (normalized.strategic_benefit ?? '').toString(),
        company: (normalized.company ?? '').toString(),

        output_metric: resolvedMetrics.output_metric ?? '',
        quality_metric: resolvedMetrics.quality_metric ?? '',
        improvement_metric: resolvedMetrics.improvement_metric ?? '',
        metrics_auto_suggested: metricsAutoSuggested,
        variation_seed
      };

      const objectiveOutput = buildObjectivesForRow(preparedRow);

      let simpleObjective = (objectiveOutput.simple_objective ?? '').toString();
      let complexObjective = (objectiveOutput.complex_objective ?? '').toString();

      if (final.status === 'INVALID') {
        simpleObjective = '';
        complexObjective = '';
      }

      const objective =
        final.status === 'INVALID'
          ? ''
          : (simpleObjective || complexObjective || '');

      const objective_mode = simpleObjective ? 'simple' : complexObjective ? 'complex' : '';

      const rowOut: KpiRowOut = {
        row_id: normalized.row_id,
        objective,
        objective_mode,
        status: final.status,
        comments: final.comments,
        summary_reason: final.summary_reason,
        error_codes: final.errorCodes,
        resolved_metrics: resolvedMetrics,
        metrics_auto_suggested: metricsAutoSuggested,
        variation_seed
      };

      return rowOut;
    });

    const response: KpiResponse = { rows: rowsOut };

    const statusCounts = rowsOut.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    logKpiInfo('kpi_request_completed_200', {
      rows_count: rowsOut.length,
      status_counts: statusCounts,
      engine_version: body.engine_version ?? 'v10.7.5'
    });

    return res.status(200).json(response);
  } catch (err) {
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