// api/bulkFinalizeExport.ts
// Final step of bulk flow.

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

 // Split rows by validity:
  const validBulkRows: BulkPreparedRow[] = bulkRows.filter((row) => row.isValid);
  const invalidBulkRows: BulkPreparedRow[] = bulkRows.filter((row) => !row.isValid);

  const engineRows: EnginePreparedRow[] = validBulkRows.map((row) => {
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
      improvement_metric: row.improvement_metric
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
      output_metric: row.output_metric,
      quality_metric: row.quality_metric,
      improvement_metric: row.improvement_metric,
      metrics_auto_suggested: row.metrics_auto_suggested === true,
      variation_seed
    };

    return engineRow;
  });

// Run objective engine ONLY on valid rows
  const objectiveOutputs = runObjectiveEngine(engineRows);

  const objectiveMap = new Map<number, { simple: string; complex: string }>();
  for (const obj of objectiveOutputs) {
    objectiveMap.set(obj.row_id, {
      simple: obj.simple_objective,
      complex: obj.complex_objective
    });
  }

  // Build final result rows in original row order
  const resultRows: KpiResultRow[] = bulkRows.map((row) => {
    const isValid = !!row.isValid;
    const invalidReason = row.invalidReason ?? '';

    // Only attach objectives for VALID rows
    const obj = isValid ? objectiveMap.get(row.row_id) : undefined;
    const simple_objective = isValid ? (obj?.simple ?? '') : '';
    const complex_objective = isValid ? (obj?.complex ?? '') : '';

    // Derive final objective (simple or complex, depending on engine decision)
    const objective = isValid ? (simple_objective || complex_objective || '') : '';

    let validation_status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
    let comments = '';
    let summary_reason = '';

    if (!isValid) {
      validation_status = 'INVALID';
      comments = invalidReason;
      summary_reason = invalidReason;
    } else if (row.metrics_auto_suggested === true) {
      validation_status = 'NEEDS_REVIEW';
      comments =
        'Objective metrics were auto-suggested based on the role matrix. Please review before approval.';
      summary_reason = comments;
    } else {
      validation_status = 'VALID';
    }

    return {
      task_name: row.task_name,
      task_type: row.task_type,
      team_role: row.team_role,
      dead_line: row.dead_line,
      objective,
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
  const needs_review_count = resultRows.filter(
    (r) => r.validation_status === 'NEEDS_REVIEW'
  ).length;

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