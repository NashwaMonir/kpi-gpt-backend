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

  let payload: BulkPrepareTokenPayload;
  try {
    payload = decodePrepareToken(prep_token);
  } catch (err) {
    res.status(400).json({
      error: 'Failed to decode prep_token.',
      detail: String(err),
    });
    return;
  }

  const preparedRows = payload.preparedRows || [];
  const objectivesMap = new Map<number, BulkObjectiveInput>();

  for (const obj of objectives) {
    if (
      obj &&
      typeof obj.row_id === 'number' &&
      (typeof obj.simple_objective === 'string' ||
        typeof obj.complex_objective === 'string')
    ) {
      objectivesMap.set(obj.row_id, obj);
    }
  }

  const rowsForExport: KpiResultRow[] = [];

  for (const row of preparedRows) {
    const obj = objectivesMap.get(row.row_id);
    if (!obj) {
      continue; // no objective for this row
    }

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
  const invalid_count = 0; // invalid rows are not exported with objectives
  const needs_review_count = rowsForExport.some((r) =>
    r.validation_status === 'NEEDS_REVIEW'
  )
    ? rowsForExport.filter((r) => r.validation_status === 'NEEDS_REVIEW').length
    : 0;

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