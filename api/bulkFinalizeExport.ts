// api/bulkFinalizeExport.ts
// Phase C: Merge GPT objectives into prepared rows, call export API, return download link.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBulkSession } from '../engine/bulkSessionStore';
import type {
  BulkFinalizeExportRequest,
  BulkFinalizeExportResponse,
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
    const body = req.body as BulkFinalizeExportRequest;

    if (!body || !body.bulk_session_id) {
      return res.status(400).json({
        error: 'Missing bulk_session_id in request.'
      });
    }

    if (!body.objectives || !Array.isArray(body.objectives)) {
      return res.status(400).json({
        error: 'Missing objectives array in request.'
      });
    }

    const session = getBulkSession(body.bulk_session_id);
    if (!session || !session.preparedRows) {
      return res.status(400).json({
        error: 'Unknown bulk_session_id or prepared rows missing.'
      });
    }

    const objectivesByRowId = new Map<
      number,
      { simple_objective: string; complex_objective: string }
    >();

    for (const obj of body.objectives) {
      if (objectivesByRowId.has(obj.row_id)) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'bulk-finalize-export',
            event: 'duplicate_objective_row_id',
            row_id: obj.row_id
          })
        );
      }

      const simple = obj.simple_objective ?? '';
      const complex =
        obj.complex_objective && obj.complex_objective.trim() !== ''
          ? obj.complex_objective
          : simple;

      objectivesByRowId.set(obj.row_id, {
        simple_objective: simple,
        complex_objective: complex
      });
    }

    // Merge objectives into prepared rows
    const rowsWithObjectives = session.preparedRows.map((row: BulkPreparedRow) => {
      const obj = objectivesByRowId.get(row.row_id) ?? {
        simple_objective: '',
        complex_objective: ''
      };

      return {
        ...row,
        simple_objective: obj.simple_objective,
        complex_objective: obj.complex_objective
      };
    });

    const baseUrl = getBaseUrl(req);

    // Build minimal payload matching /api/runKpiResultExport schema (Action.json)
    const exportRows = rowsWithObjectives.map((r) => ({
      task_name: r.task_name ?? '',
      task_type: r.task_type ?? '',
      team_role: r.team_role ?? '',
      dead_line: r.dead_line ?? '',
      simple_objective: r.simple_objective ?? '',
      complex_objective: r.simple_objective ?? '',
      validation_status: r.status,
      comments: r.comments ?? '',
      summary_reason: r.summary_reason ?? ''
    }));

    const exportPayload = {
      rows: exportRows
    };

    const exportResult = await postJson<{ download_url: string }>(
      `${baseUrl}/api/runKpiResultExport`,
      exportPayload
    );

    const valid_count = rowsWithObjectives.filter((r) => r.status === 'VALID').length;
    const needs_review_count = rowsWithObjectives.filter(
      (r) => r.status === 'NEEDS_REVIEW'
    ).length;
    const invalid_count = rowsWithObjectives.filter(
      (r) => r.status === 'INVALID'
    ).length;

    const ui_message =
      `KPI export completed: ${valid_count} VALID, ` +
      `${needs_review_count} NEEDS_REVIEW, ${invalid_count} INVALID row(s). ` +
      `Download the Excel file using the link below.`;

    const response: BulkFinalizeExportResponse = {
      download_url: exportResult.download_url,
      valid_count,
      needs_review_count,
      invalid_count,
      ui_message
    };

    return res.status(200).json(response);
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'bulk-finalize-export',
        event: 'unhandled_exception',
        message: err instanceof Error ? err.message : String(err)
      })
    );

    return res.status(500).json({
      error: 'Internal bulkFinalizeExport error.'
    });
  }
}