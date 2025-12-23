// api/bulkFinalizeExport.ts
// Final step of bulk flow.

import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  BulkFinalizeExportRequest,
  BulkFinalizeExportResponse,
  decodePrepareToken,
  PreparedRow as BulkPreparedRow,
  KpiResultRow
} from '../engine/bulkTypes';

import type { PreparedRow as EnginePreparedRow, KpiRowIn, Mode } from '../engine/types';

import { computeVariationSeed } from '../engine/variationSeed';
import { runObjectiveEngine } from '../engine/objectiveEngine';
import { resolveMetrics } from '../engine/metricsAutoSuggest';

import { ErrorCodes, addErrorCode } from '../engine/errorCodes';
import type { ErrorCode } from '../engine/errorCodes';
import {
  normalizeTaskType,
  normalizeTeamRole,
  normalizeMode,
  toSafeTrimmedString,
  normalizeDeadline
} from '../engine/normalizeFields';
import { validateDeadline } from '../engine/validateDeadline';
import { isDangerousBenefitText, evaluateMetricsDangerous } from '../engine/validateDangerous';
import { buildErrorMessage } from '../engine/buildErrorMessage';

// NEW: Blob storage (short, stable download_url)
import { put } from '@vercel/blob';
import crypto from 'crypto';

// NEW: shared XLSX builder (no duplication). We will create this file next.
import { buildKpiOutputWorkbook } from '../engine/kpiWorkbook';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toUtcDateISO(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toSafeIsoTimestamp(d: Date): string {
  // "YYYY-MM-DDTHH-mm-ssZ" (safe in keys)
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const { preparedRows} = decoded;
  const bulkRows: BulkPreparedRow[] = preparedRows || [];

  if (!Array.isArray(bulkRows) || bulkRows.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'NO_PREPARED_ROWS',
      message: 'bulkFinalizeExport: no prepared rows found in prep_token.'
    });
  }

  // --- Bulk row assessment and engine row preparation ---

  type RowAssessment = {
    status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
    comments: string;
    metrics_auto_suggested: boolean;
    error_codes: string[];
    mode: Mode;
  };

  function assessRow(row: BulkPreparedRow): RowAssessment {
    const errorCodes: ErrorCode[] = [];

    const team_role = toSafeTrimmedString(row.team_role);
    const task_type = toSafeTrimmedString(row.task_type);
    const task_name = toSafeTrimmedString(row.task_name);
    const dead_line = toSafeTrimmedString(row.dead_line);
    const strategic_benefit = toSafeTrimmedString((row as any).strategic_benefit);

    const output_metric = toSafeTrimmedString((row as any).output_metric);
    const quality_metric = toSafeTrimmedString((row as any).quality_metric);
    const improvement_metric = toSafeTrimmedString((row as any).improvement_metric);

    // 1) Missing mandatory fields (bulk minimum)
    const missing: string[] = [];
    if (!task_name) {
      addErrorCode(errorCodes, ErrorCodes.MISSING_TASK_NAME as any);
      missing.push('Task Name');
    }
    if (!task_type) {
      addErrorCode(errorCodes, ErrorCodes.MISSING_TASK_TYPE as any);
      missing.push('Task Type');
    }
    if (!team_role) {
      addErrorCode(errorCodes, ErrorCodes.MISSING_TEAM_ROLE as any);
      missing.push('Team Role');
    }
    if (!dead_line) {
      addErrorCode(errorCodes, ErrorCodes.MISSING_DEADLINE as any);
      missing.push('Deadline');
    }
    if (!strategic_benefit) {
      addErrorCode(errorCodes, ErrorCodes.MISSING_STRATEGIC_BENEFIT as any);
      missing.push('Strategic Benefit');
    }

    // 2) Normalize + validate enums
    const taskTypeNorm = normalizeTaskType(task_type);
    if (task_type && !taskTypeNorm.isAllowed) {
      addErrorCode(errorCodes, ErrorCodes.INVALID_TASK_TYPE as any);
    } else if (taskTypeNorm.isAllowed && taskTypeNorm.normalized) {
      // ✅ Persist canonical task_type for matrix + objective parity
      (row as any).task_type = taskTypeNorm.normalized;
    }

    const roleNorm = normalizeTeamRole(team_role);
    if (team_role && !roleNorm.isAllowed) {
      addErrorCode(errorCodes, ErrorCodes.INVALID_TEAM_ROLE as any);
    } else if (roleNorm.isAllowed && roleNorm.normalized) {
      // ✅ Persist canonical team_role for matrix + objective parity
      (row as any).team_role = roleNorm.normalized;
    }

    // 3) Deadline validation (format + engine-year)
    const deadline = validateDeadline(dead_line, errorCodes as any);

    // Persist normalized ISO deadline back onto the bulk row for downstream parity.
    // This makes bulk objective generation and exports use the same YYYY-MM-DD canonical form.
    if (deadline.valid) {
      const n = normalizeDeadline(dead_line);
      if (n.isValid && n.normalized) {
        // Persist canonical ISO directly on the row
        (row as any).dead_line = n.normalized;
      }
    }

    // 4) Dangerous / low-signal benefit
    if (strategic_benefit && isDangerousBenefitText(strategic_benefit, errorCodes as any)) {
      // isDangerousBenefitText adds E401/E402 category error codes
    }

    // 5) Dangerous / low-signal metrics (only for non-empty metrics)
    evaluateMetricsDangerous(output_metric, quality_metric, improvement_metric, errorCodes as any);

    // 6) Mode normalization
    const modeNorm = normalizeMode((row as any).mode, errorCodes as any);

    // 7) Metrics auto-suggest semantics (bulk contract):
    // If any metric is missing, bulk must surface NEEDS_REVIEW.
    const metricsMissing = !output_metric || !quality_metric || !improvement_metric;
    if (metricsMissing) {
      // Preserve canonical E501/E502 mapping.
      if (!output_metric && !quality_metric && !improvement_metric) {
        addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_ALL as any);
      } else {
        addErrorCode(errorCodes, ErrorCodes.METRICS_AUTOSUGGEST_PARTIAL as any);
      }
    }

    // 8) Status derivation
    // INVALID if: missing mandatory, invalid enums, dangerous/low-signal, or invalid deadline/wrong-year
    const hasBlocking =
      missing.length > 0 ||
      errorCodes.includes(ErrorCodes.INVALID_TASK_TYPE) ||
      errorCodes.includes(ErrorCodes.INVALID_TEAM_ROLE) ||
      errorCodes.includes(ErrorCodes.DANGEROUS_TEXT) ||
      errorCodes.includes(ErrorCodes.LOW_SIGNAL_TEXT) ||
      !deadline.valid ||
      (deadline.valid && deadline.wrongYear);

    let status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID' = 'VALID';
    if (hasBlocking) status = 'INVALID';
    else if (metricsMissing || modeNorm.wasInvalid) status = 'NEEDS_REVIEW';

    const metrics_auto_suggested =
      status === 'INVALID' ? false : metricsMissing;

    const finalMessage = buildErrorMessage({
      status,
      error_codes: errorCodes,
      metrics_auto_suggested,
      missing_fields: missing,
      deadline_validation: deadline
    });

    const comments = finalMessage.comments;

    return {
      status,
      comments,
      metrics_auto_suggested,
      error_codes: Array.from(new Set(errorCodes)).map(String).sort(),
      mode: modeNorm.mode
    };
  }

  // Assess all rows using engine-aligned rules
  const assessments = new Map<number, RowAssessment>();
  for (const row of bulkRows) {
    assessments.set(row.row_id, assessRow(row));
  }

  // Build engine rows for rows that can generate objectives (VALID + NEEDS_REVIEW)
  const engineRows: EnginePreparedRow[] = bulkRows
    .filter((r) => {
      const a = assessments.get(r.row_id);
      return a?.status !== 'INVALID';
    })
    .map((row) => {
      // --- Canonicalize fields for strict single vs bulk parity ---
      // Do not rely on prior row mutation; re-derive canonical forms here.
      const team_role_raw = toSafeTrimmedString(row.team_role);
      const task_type_raw = toSafeTrimmedString(row.task_type);

      const roleNorm2 = normalizeTeamRole(team_role_raw);
      const taskNorm2 = normalizeTaskType(task_type_raw);

      // If normalization fails (should have been caught in assessRow), fall back to trimmed raw.
      const team_role_canonical =
        roleNorm2.isAllowed && roleNorm2.normalized ? roleNorm2.normalized : team_role_raw;
      const task_type_canonical =
        taskNorm2.isAllowed && taskNorm2.normalized ? taskNorm2.normalized : task_type_raw;

      // Canonical ISO deadline for parity across single and bulk flows.
      // assessRow() already attempted to persist ISO; normalize again for safety.
      const dead_line_raw = toSafeTrimmedString(row.dead_line);
      const dlNorm2 = normalizeDeadline(dead_line_raw);
      const dead_line_iso = dlNorm2.isValid && dlNorm2.normalized ? dlNorm2.normalized : dead_line_raw;

      const output_metric_in = toSafeTrimmedString((row as any).output_metric);
      const quality_metric_in = toSafeTrimmedString((row as any).quality_metric);
      const improvement_metric_in = toSafeTrimmedString((row as any).improvement_metric);

      // --- Variation seed (single source of truth) ---
      // Prefer the seed generated in bulkPrepareRows (stored in prep_token) to guarantee
      // strict parity across the bulk pipeline. If missing, recompute using the same canonical
      // (team_role, task_type, company, row_id) features used by /api/kpi.
      const seedFromPrep = (row as any).variation_seed;
      const variation_seed =
        typeof seedFromPrep === 'number' && Number.isFinite(seedFromPrep)
          ? seedFromPrep
          : computeVariationSeed({
              row_id: row.row_id,
              company: row.company,
              team_role: team_role_canonical,
              task_type: task_type_canonical
            } as any);
      (row as any).variation_seed = variation_seed;

      // Resolve metrics exactly like /api/kpi (matrix + role defaults) when any metric is missing.
      // This is required for single vs bulk objective parity.
      const rowForResolution: KpiRowIn = {
        row_id: row.row_id,
        company: row.company,
        team_role: team_role_canonical,
        task_type: task_type_canonical,
        task_name: row.task_name,
        dead_line: dead_line_iso,
        strategic_benefit: (row as any).strategic_benefit,
        output_metric: output_metric_in,
        quality_metric: quality_metric_in,
        improvement_metric: improvement_metric_in
      };

      const anyMetricMissingAtInput = !output_metric_in || !quality_metric_in || !improvement_metric_in;

      // We do not need to mutate the row-level error codes here because assessRow already
      // adds canonical E501/E502 for metrics-missing. This call is only to obtain the filled metrics.
      const resolved = anyMetricMissingAtInput
        ? resolveMetrics(rowForResolution, variation_seed, [] as any)
        : {
            output_metric: output_metric_in,
            quality_metric: quality_metric_in,
            improvement_metric: improvement_metric_in,
            used_default_metrics: false
          };

      // Persist resolved metrics onto the bulk row so exports (and encoded payload) are auditable.
      // This is safe because only VALID/NEEDS_REVIEW rows are included in engineRows.
      (row as any).output_metric = (resolved as any).output_metric ?? '';
      (row as any).quality_metric = (resolved as any).quality_metric ?? '';
      (row as any).improvement_metric = (resolved as any).improvement_metric ?? '';
      (row as any).metrics_auto_suggested = anyMetricMissingAtInput || !!(resolved as any).used_default_metrics;

      const engineRow: EnginePreparedRow = {
        row_id: row.row_id,
        team_role: team_role_canonical,
        task_type: task_type_canonical,
        task_name: row.task_name,
        dead_line: dead_line_iso,
        strategic_benefit: (row as any).strategic_benefit,
        company: row.company,

        // Use resolved metrics so bulk objective includes the same auto-suggested metric text as single.
        output_metric: (resolved as any).output_metric ?? '',
        quality_metric: (resolved as any).quality_metric ?? '',
        improvement_metric: (resolved as any).improvement_metric ?? '',

        // v10.8 contract: metrics_auto_suggested must be true whenever ANY metric is auto-filled
        // (partial or default). In this engine, metrics are only auto-filled when at least one input metric is missing.
        metrics_auto_suggested: anyMetricMissingAtInput || !!(resolved as any).used_default_metrics,
        variation_seed
      };

      return engineRow;
    });

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
    const a = assessments.get(row.row_id)!;

    // Only attach objectives for VALID/NEEDS_REVIEW rows
    const obj = a.status === 'INVALID' ? undefined : objectiveMap.get(row.row_id);
    const simple_objective = a.status === 'INVALID' ? '' : (obj?.simple ?? '');
    const complex_objective = a.status === 'INVALID' ? '' : (obj?.complex ?? '');

    // Derive final objective (simple or complex, depending on mode)
    const objective = a.status === 'INVALID' ? '' : (simple_objective || complex_objective || '');

    // Canonical ISO deadline for export.
    // assessRow() already persisted ISO onto row.dead_line when valid.
    const dead_line = toSafeTrimmedString(row.dead_line);

    return {
      row_id: row.row_id,
      task_name: row.task_name,
      task_type: row.task_type,
      team_role: row.team_role,
      dead_line,
      objective,

      // Metrics are included for auditability and exact bulk assertions.
      output_metric: a.status === 'INVALID' ? '' : toSafeTrimmedString((row as any).output_metric),
      quality_metric: a.status === 'INVALID' ? '' : toSafeTrimmedString((row as any).quality_metric),
      improvement_metric: a.status === 'INVALID' ? '' : toSafeTrimmedString((row as any).improvement_metric),
      metrics_auto_suggested: a.status === 'INVALID' ? false : !!(row as any).metrics_auto_suggested,

      validation_status: a.status,
      comments: a.comments,
      // v10.8 Lite: summary_reason removed
      summary_reason: ''
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

  // NEW: Blob-backed download URL (short, stable)
  try {
    const now = new Date();
    const dateISO = toUtcDateISO(now);
    const fileName = `KPI_Output_${dateISO}.xlsx`;

    const iso_timestamp = toSafeIsoTimestamp(now);
    const request_id = crypto.randomUUID();

    // Your chosen pattern B: kpi-results/{iso_timestamp}_{request_id}.xlsx
    const pathname = `kpi-results/${iso_timestamp}_${request_id}.xlsx`;

    // Build the workbook bytes (shared builder; implemented next file)
    const xlsxBuffer = await buildKpiOutputWorkbook(resultRows, dateISO);

    const blob = await put(pathname, xlsxBuffer, {
      access: 'public',
      contentType: XLSX_CONTENT_TYPE,
      addRandomSuffix: false
    });

    const download_url = blob.url;

    const response: BulkFinalizeExportResponse = {
      download_url,
      valid_count,
      needs_review_count,
      invalid_count,
      ui_message:
        `KPI result file is ready. Click the link to download ${fileName}.`
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('[bulkFinalizeExport] Blob upload failed', err);
    return res.status(500).json({
      error: true,
      code: 'BULK_EXPORT_STORAGE_FAILED',
      message:
        'Bulk export completed, but failed to store the output file for download.'
    });
  }
}