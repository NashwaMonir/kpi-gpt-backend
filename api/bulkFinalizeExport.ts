// api/bulkFinalizeExport.ts
// Final step of bulk flow:
//  - Accepts prep_token from bulkPrepareRows
//  - Decodes prepared rows
//  - Computes variation_seed per row
//  - Calls objectiveEngine (runObjectiveEngine) to generate objectives
//  - Builds result rows and returns a download_url for KPI_Output.xlsx

import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  BulkFinalizeExportRequest,
  BulkFinalizeExportResponse,
  decodePrepareToken,
  encodeRowsForDownload,
  PreparedRow as BulkPreparedRow,
  KpiResultRow
} from '../engine/bulkTypes';

import type { PreparedRow as EnginePreparedRow, KpiRowIn } from '../engine/types';

import { computeVariationSeed } from '../engine/variationSeed';
import { runObjectiveEngine } from '../engine/objectiveEngine';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as BulkFinalizeExportRequest | undefined;

  if (!body || typeof body.prep_token !== 'string' || body.prep_token.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'MISSING_PREP_TOKEN',
      message: 'bulkFinalizeExport requires a non-empty prep_token.'
    });
  }

  let decoded;
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
  const bulkRows: BulkPreparedRow[] = preparedRows || [];

  if (!Array.isArray(bulkRows) || bulkRows.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'NO_PREPARED_ROWS',
      message: 'bulkFinalizeExport: no prepared rows found in prep_token.'
    });
  }

  // Map bulk PreparedRow → canonical engine PreparedRow with variation_seed
  const engineRows: EnginePreparedRow[] = bulkRows.map((row) => {
    const kpiRow: KpiRowIn = {
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
      mode: row.mode
    };

    const variation_seed = computeVariationSeed(kpiRow);

    const engineRow: EnginePreparedRow = {
      row_id: row.row_id,
      team_role: row.team_role,
      task_type: row.task_type,
      task_name: row.task_name,
      dead_line: row.dead_line,
      strategic_benefit: row.strategic_benefit,
      company: row.company,
      mode: row.mode,
      output_metric: row.output_metric,
      quality_metric: row.quality_metric,
      improvement_metric: row.improvement_metric,
      variation_seed
    };

    return engineRow;
  });

  // Generate objectives via shared objective engine
  const objectiveOutputs = runObjectiveEngine(engineRows);

  // Build a map row_id → objective for convenience
  const objectiveMap = new Map<number, { simple: string; complex: string }>();
  for (const obj of objectiveOutputs) {
    objectiveMap.set(obj.row_id, {
      simple: obj.simple_objective,
      complex: obj.complex_objective
    });
  }

  // Build final result rows for Excel
  const resultRows: KpiResultRow[] = bulkRows.map((row) => {
    const obj = objectiveMap.get(row.row_id);

    // For now, use basic validity-derived status; future version can align
    // with full VALID / NEEDS_REVIEW / INVALID engine status if needed.
    const validation_status = row.isValid ? 'VALID' : 'INVALID';
    const comments = row.invalidReason ?? '';
    const summary_reason = row.invalidReason ?? '';

    return {
      task_name: row.task_name,
      task_type: row.task_type,
      team_role: row.team_role,
      dead_line: row.dead_line,
      simple_objective: obj?.simple ?? '',
      complex_objective: obj?.complex ?? '',
      validation_status,
      comments,
      summary_reason
    };
  });

  const valid_count = resultRows.filter(
    (r) => r.validation_status === 'VALID'
  ).length;
  const invalid_count = resultRows.filter(
    (r) => r.validation_status === 'INVALID'
  ).length;
  const needs_review_count = 0; // extension point for future NEEDS_REVIEW status

  const host = req.headers.host ?? null;
  const download_url = encodeRowsForDownload(resultRows, host);

  const response: BulkFinalizeExportResponse = {
    download_url,
    valid_count,
    needs_review_count,
    invalid_count,
    ui_message:
      'KPI result file is ready. Click the link to download KPI_Output.xlsx.'
  };

  return res.status(200).json(response);
}