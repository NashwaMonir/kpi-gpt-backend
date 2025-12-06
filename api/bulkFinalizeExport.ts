// api/bulkFinalizeExport.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  BulkFinalizeExportRequest,
  BulkFinalizeExportResponse,
  BulkPrepareTokenPayload,
  KpiResultRow,
  decodePrepareToken,
  encodeRowsForDownload
} from '../engine/bulkTypes';
import { runObjectiveEngine } from '../engine/objectiveEngine';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as BulkFinalizeExportRequest | undefined;

  if (!body || !body.prep_token || typeof body.prep_token !== 'string') {
    return res.status(400).json({
      error: true,
      code: 'MISSING_PREP_TOKEN',
      message: 'bulkFinalizeExport requires a non-empty prep_token.'
    });
  }

  let decoded: BulkPrepareTokenPayload;
  try {
    decoded = decodePrepareToken(body.prep_token);
  } catch (err) {
    return res.status(400).json({
      error: true,
      code: 'INVALID_PREP_TOKEN',
      message: 'prep_token could not be decoded.'
    });
  }

  const { preparedRows, summary } = decoded;

  if (!Array.isArray(preparedRows) || preparedRows.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'NO_PREPARED_ROWS',
      message: 'bulkFinalizeExport: no prepared rows available for objective generation.'
    });
  }

  const objectiveOutputs = runObjectiveEngine(preparedRows);

  const objectivesByRowId = new Map<number, { simple: string; complex: string }>();
  for (const obj of objectiveOutputs) {
    objectivesByRowId.set(obj.row_id, {
      simple: obj.simple_objective,
      complex: obj.complex_objective
    });
  }

  const resultRows: KpiResultRow[] = [];

  for (const row of preparedRows) {
    const obj = objectivesByRowId.get(row.row_id);

    const simple_objective = obj?.simple ?? '';
    const complex_objective = obj?.complex ?? '';

    const validation_status = row.isValid ? 'VALID' : 'INVALID';
    const comments = row.isValid
      ? 'Bulk flow: structurally valid.'
      : row.invalidReason || 'Bulk flow: invalid row.';

    const resultRow: KpiResultRow = {
      task_name: row.task_name,
      task_type: row.task_type,
      team_role: row.team_role,
      dead_line: row.dead_line,
      simple_objective,
      complex_objective,
      validation_status,
      comments,
      summary_reason: ''
    };

    resultRows.push(resultRow);
  }

  const valid_count = resultRows.filter((r) => r.validation_status === 'VALID').length;
  const invalid_count = resultRows.filter((r) => r.validation_status === 'INVALID').length;
  const needs_review_count = 0; // extension point

  const host = (req.headers['host'] as string | undefined) ?? null;
  const download_url = encodeRowsForDownload(resultRows, host);

  const ui_message = `${valid_count} objective(s) exported. Download KPI_Output.xlsx.`;

  const response: BulkFinalizeExportResponse = {
    download_url,
    valid_count,
    needs_review_count,
    invalid_count,
    ui_message
  };

  return res.status(200).json(response);
}