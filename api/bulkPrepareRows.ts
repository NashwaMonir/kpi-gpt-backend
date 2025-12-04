// api/bulkPrepareRows.ts
// Phase B: Apply user decision, run company-preflight (analyze+rewrite),
// run KPI engine, return validated rows.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBulkSession, updateBulkPreparedRows } from '../engine/bulkSessionStore';
import type {
  BulkPrepareRowsRequest,
  BulkPrepareRowsResponse,
  ParsedRow,
  BulkPreparedRow
} from '../engine/bulkTypes';

function getBaseUrl(req: VercelRequest): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    (req.headers['x-forwarded-proto'] as string[])?.[0] ||
    'https';
  const host = req.headers.host ?? '';
  return `${proto}://${host}`;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${url} failed: ${resp.status} – ${text}`);
  }

  return (await resp.json()) as T;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = req.body as BulkPrepareRowsRequest;

    if (!body || !body.bulk_session_id) {
      return res.status(400).json({
        error: 'Missing bulk_session_id in request.'
      });
    }

    const session = getBulkSession(body.bulk_session_id);
    if (!session) {
      return res.status(400).json({
        error: 'Unknown or expired bulk_session_id.'
      });
    }

    const { parsedRows, summary } = session;

    const {
      selected_company,
      generic_mode,
      apply_to_missing,
      mismatched_strategy,
      invalid_handling
    } = body;

    const baseUrl = getBaseUrl(req);

    // 1) Build rows for company-preflight
    const preflightRows = parsedRows.map(r => ({
      row_id: r.row_id,
      company: (r.company ?? '').trim(),
      strategic_benefit: (r.strategic_benefit ?? '').trim()
    }));

    // 2) ANALYZE
    const analyzePayload = {
      mode: 'analyze' as const,
      selected_company: selected_company ?? '',
      generic_mode: !!generic_mode,
      rows: preflightRows
    };

    const analyzeResult = await postJson<any>(
      `${baseUrl}/api/company-preflight`,
      analyzePayload
    );

    // Basic sanity check
    const excelRowCount = parsedRows.length;
    const preflightRowCount = Array.isArray(analyzeResult?.per_row_status)
      ? analyzeResult.per_row_status.length
      : 0;

    if (excelRowCount > 0 && preflightRowCount === 0) {
      // Mapping issue fallback: log warning for debugging.
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'bulk-prepare-rows',
          event: 'preflight_zero_rows',
          excelRowCount,
          preflightRowCount
        })
      );
    }

    // 3) Handle invalid rows policy
    const effectiveRows: ParsedRow[] =
      invalid_handling === 'skip'
        ? parsedRows.filter(r => r.isValid !== false)
        : parsedRows;

    if (invalid_handling === 'abort' && summary.has_invalid_rows) {
      return res.status(400).json({
        error:
          'Bulk file contains invalid rows and invalid_handling = "abort". No objectives will be generated.'
      });
    }

    // 4) REWRITE (if there is at least one row)
    let rewriteMap = new Map<
      number,
      { row_id: number; company: string; strategic_benefit: string }
    >();

    if (effectiveRows.length > 0) {
      const rewritePayload = {
        mode: 'rewrite' as const,
        selected_company: selected_company ?? '',
        generic_mode: !!generic_mode,
        apply_to_missing: !!apply_to_missing,
        mismatched_strategy: mismatched_strategy ?? 'keep',
        rows: preflightRows
      };

      const rewriteResult = await postJson<{
        rows: { row_id: number; company: string; strategic_benefit: string }[];
      }>(`${baseUrl}/api/company-preflight`, rewritePayload);

      rewriteMap = new Map(
        (rewriteResult.rows || []).map(r => [r.row_id, r])
      );
    }

    // 5) Build final rows for KPI engine with company precedence: rewrite > CSV > selected_company
    const rowsForEngine = effectiveRows.map(input => {
      const rewrite = rewriteMap.get(input.row_id);

      const csvCompany = (input.company ?? '').trim();
      const rewrittenCompany = (rewrite?.company ?? '').trim();
      const finalCompany =
        rewrittenCompany || csvCompany || (selected_company ?? '');

      const finalStrategic =
        (rewrite?.strategic_benefit || input.strategic_benefit || '').trim();

      return {
        row_id: input.row_id,
        company: finalCompany || undefined,
        team_role: (input.team_role ?? '').trim(),
        task_type: (input.task_type ?? '').trim(),
        task_name: (input.task_name ?? '').trim(),
        dead_line: (input.dead_line ?? '').trim(),
        strategic_benefit: finalStrategic,
        output_metric: (input.output_metric ?? '').trim(),
        quality_metric: (input.quality_metric ?? '').trim(),
        improvement_metric: (input.improvement_metric ?? '').trim(),
        mode: (input.mode ?? 'both') || 'both'
      };
    });

    // 6) Call KPI engine
    const kpiPayload = {
      engine_version: 'v10.7.5',
      default_company: selected_company ?? '',
      rows: rowsForEngine
    };

    const kpiResult = await postJson<{ rows: any[] }>(
      `${baseUrl}/api/kpi`,
      kpiPayload
    );

    const preparedRows: BulkPreparedRow[] = (kpiResult.rows || []).map(row => ({
      row_id: row.row_id,
      company: row.company,
      team_role: row.team_role,
      task_type: row.task_type,
      task_name: row.task_name,
      dead_line: row.dead_line,
      strategic_benefit: row.strategic_benefit,
      output_metric: row.output_metric,
      quality_metric: row.quality_metric,
      improvement_metric: row.improvement_metric,
      mode: row.mode,
      status: row.status,
      comments: row.comments,
      summary_reason: row.summary_reason,
      errorCodes: row.errorCodes || row.error_codes || [],
      resolved_metrics: row.resolved_metrics
    }));

    updateBulkPreparedRows(body.bulk_session_id, preparedRows);

    const validCount = preparedRows.filter(r => r.status === 'VALID').length;
    const needsReviewCount = preparedRows.filter(
      r => r.status === 'NEEDS_REVIEW'
    ).length;
    const invalidCount = preparedRows.filter(r => r.status === 'INVALID').length;

    const ui_summary =
      `Bulk KPI validation completed: ${validCount} VALID, ` +
      `${needsReviewCount} NEEDS_REVIEW, ${invalidCount} INVALID row(s). ` +
      `Generate objectives only for VALID and NEEDS_REVIEW rows.`;

    const response: BulkPrepareRowsResponse = {
      bulk_session_id: body.bulk_session_id,
      state: 'READY_FOR_OBJECTIVES',
      ui_summary,
      rows: preparedRows
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'bulk-prepare-rows',
        event: 'unhandled_exception',
        message: err instanceof Error ? err.message : String(err)
      })
    );

    return res.status(500).json({
      error: 'Internal bulkPrepareRows error.'
    });
  }
}