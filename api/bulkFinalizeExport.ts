// api/bulkFinalizeExport.ts
// Step 3: prep_token + objectives → Excel download URL (via runKpiResultDownload)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  BulkFinalizeExportRequest,
  BulkFinalizeExportResponse,
  BulkPrepareTokenPayload,
  BulkObjectiveInput,
  decodePrepareToken,
  encodeRowsForDownload,
  KpiResultRow,
} from '../engine/bulkTypes';

function parseBody(req: VercelRequest): BulkFinalizeExportRequest {
  const body = req.body;
  if (!body) {
    return {} as BulkFinalizeExportRequest;
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as BulkFinalizeExportRequest;
    } catch {
      return {} as BulkFinalizeExportRequest;
    }
  }
  return body as BulkFinalizeExportRequest;
}

/**
 * Try to extract the prepared rows array from the decoded token payload.
 * We don't trust the exact key; we look for any array of objects with row_id.
 */
function extractPreparedRows(payload: BulkPrepareTokenPayload | any): any[] {
  // 1) Preferred: explicit keys
  if (Array.isArray(payload.preparedRows)) {
    return payload.preparedRows;
  }
  if (Array.isArray(payload.prepared_rows)) {
    return payload.prepared_rows;
  }

  // 2) Fallback: search any top-level array that looks like rows
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && typeof first === 'object' && 'row_id' in first) {
        return value;
      }
    }
  }

  // 3) Nothing found
  return [];
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST with JSON body.' });
    return;
  }

  const reqBody = parseBody(req);
  const { prep_token, objectives } = reqBody;

  if (!prep_token || typeof prep_token !== 'string') {
    res.status(400).json({ error: 'Missing or invalid prep_token.' });
    return;
  }
  if (!Array.isArray(objectives) || objectives.length === 0) {
    res.status(400).json({ error: 'Missing objectives array.' });
    return;
  }

  let payload: BulkPrepareTokenPayload | any;
  try {
    payload = decodePrepareToken(prep_token);
  } catch (err) {
    res.status(400).json({
      error: 'Failed to decode prep_token.',
      detail: String(err),
    });
    return;
  }

  // Extract prepared rows robustly
  const preparedRows = extractPreparedRows(payload);

  const objectivesMap = new Map<number, BulkObjectiveInput>();

  for (const obj of objectives) {
    if (
      obj &&
      typeof obj.row_id === 'number' &&
      typeof obj.simple_objective === 'string' &&
      typeof obj.complex_objective === 'string'
    ) {
      objectivesMap.set(obj.row_id, obj);
    }
  }

  const rowsForExport: KpiResultRow[] = [];

  for (const row of preparedRows) {
    if (!row || typeof row.row_id !== 'number') continue;

    const obj = objectivesMap.get(row.row_id);
    if (!obj) continue; // no objective for this row

    rowsForExport.push({
      task_name: row.task_name ?? '',
      task_type: row.task_type ?? '',
      team_role: row.team_role ?? '',
      dead_line: row.dead_line ?? '',
      simple_objective: obj.simple_objective ?? '',
      complex_objective: obj.complex_objective ?? '',
      validation_status: row.isValid ? 'VALID' : 'NEEDS_REVIEW',
      comments: row.isValid
        ? 'Bulk flow: structurally valid.'
        : row.invalidReason || 'Bulk flow: structural issues detected.',
      summary_reason: '',
    });
  }

  const valid_count = rowsForExport.length;
  const needs_review_count = rowsForExport.filter(
    (r) => r.validation_status === 'NEEDS_REVIEW'
  ).length;
  const invalid_count = 0; // invalid rows are not exported with objectives

  const hostHeader = req.headers.host || null;
  const download_url = encodeRowsForDownload(rowsForExport, hostHeader);

  const ui_message = `${valid_count} objective(s) exported. Download KPI_Output.xlsx.`;

  const response: BulkFinalizeExportResponse = {
    download_url,
    valid_count,
    needs_review_count,
    invalid_count,
    ui_message,
  };

  res.status(200).json(response);
}