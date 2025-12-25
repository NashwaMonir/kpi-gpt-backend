// api/bulkPrepareRows.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  BulkPrepareRowsRequest,
  BulkPrepareRowsResponse,
  BulkPrepareTokenPayload,
  ParsedRow,
  PreparedRow,
  decodeRowsToken,
  encodePrepareToken
} from '../engine/bulkTypes';
import { normalizeDeadline, normalizeTeamRole, normalizeTaskType } from '../engine/normalizeFields';
import { computeVariationSeed } from '../engine/variationSeed';
import type { KpiRowIn } from '../engine/types';

function applyCompanyStrategy(
  row: ParsedRow,
  params: {
    selected_company?: string | null;
    generic_mode?: boolean;
    apply_to_missing?: boolean;
    mismatched_strategy?: 'keep' | 'overwrite';
  }
): string {
  const generic_mode = params.generic_mode === true;
  const selected_company = (params.selected_company ?? '').trim();
  const apply_to_missing = params.apply_to_missing !== false; // default true
  const mismatched_strategy = params.mismatched_strategy ?? 'keep';

  if (generic_mode) {
    return '';
  }

  let company = row.company;

  if (selected_company) {
    if (!company && apply_to_missing) {
      company = selected_company;
    } else if (company && company !== selected_company) {
      if (mismatched_strategy === 'overwrite') {
        company = selected_company;
      }
      // if 'keep', do nothing
    }
  }

  return company;
}

function applyCompanyPolicy(
  row: ParsedRow,
  policy: {
    mode: 'row_level' | 'single_company';
    single_company_name?: string | null;
    overwrite_existing_companies?: boolean;
    missing_company_policy?: 'use_single_company' | 'generic';
  }
): string {
  const mode = policy.mode;
  const single_company_name = String(policy.single_company_name ?? '').trim();
  const overwrite_existing_companies = policy.overwrite_existing_companies === true;
  const missing_company_policy = policy.missing_company_policy ?? 'generic';

  const existing = String(row.company ?? '').trim();

  // Defensive: if caller selected a single-company mode but provided no name,
  // do not destroy row-level data; fall back to existing.
  if (mode === 'single_company' && !single_company_name) {
    return existing;
  }

  if (mode === 'single_company') {
    if (overwrite_existing_companies) {
      return single_company_name;
    }
    // Only fill missing
    return existing ? existing : single_company_name;
  }

  // mode === 'row_level'
  if (existing) return existing;

  if (missing_company_policy === 'use_single_company' && single_company_name) {
    return single_company_name;
  }

  // missing_company_policy === 'generic' OR no single company provided
  return '';
}

/**
 * IMPORTANT (v10.8): bulkPrepareRows is a *normalization and company-strategy* step.
 * - It may normalize Task Type / Team Role into canonical labels.
 * - It does NOT perform full engine validation (deadline year/format, dangerous text,
 *   metrics auto-suggest, or final status derivation).
 * - Full validation and final VALID/NEEDS_REVIEW/INVALID status is enforced in bulkFinalizeExport.
 *
 * To keep bulk exports audit-safe and consistent with /api/kpi, invalid rows are preserved by default.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as BulkPrepareRowsRequest | undefined;

  if (!body || typeof body.rows_token !== 'string' || body.rows_token.length === 0) {
    return res.status(400).json({
      error: true,
      code: 'MISSING_ROWS_TOKEN',
      message: 'bulkPrepareRows requires a non-empty rows_token.'
    });
  }

  let decoded;
  try {
    decoded = decodeRowsToken(body.rows_token);
  } catch (err) {
    return res.status(400).json({
      error: true,
      code: 'INVALID_ROWS_TOKEN',
      message: 'rows_token could not be decoded.'
    });
  }

  const { parsedRows, summaryMeta } = decoded;

  // v10.8/v11 contract: invalid rows are always preserved so bulkFinalizeExport can emit
  // deterministic INVALID / NEEDS_REVIEW outcomes and maintain row-count parity.
  // (Any prior "skip" behavior is intentionally disabled.)

  const preparedRows: PreparedRow[] = [];

  for (const row of parsedRows) {
    const finalCompany = body.company_policy
      ? applyCompanyPolicy(row, body.company_policy)
      : applyCompanyStrategy(row, {
          selected_company: body.selected_company,
          generic_mode: body.generic_mode,
          apply_to_missing: body.apply_to_missing,
          mismatched_strategy: body.mismatched_strategy
        });

    // Normalize team_role and task_type using the same helpers as the single-row API.
    const teamRoleResult = normalizeTeamRole(row.team_role);
    const taskTypeResult = normalizeTaskType(row.task_type);

    // v10.8 lock: persist canonical deadline shape into the prep token.
    // - Always normalize via the same normalizer as single-row flow.
    // - Overwrite dead_line with ISO before the engine sees it.
    // - Keep trimmed raw only when invalid (diagnostics/export only).
    const rawDeadline = String(row.dead_line ?? '').trim();
    const nDeadline = normalizeDeadline(rawDeadline);
    const dead_line = (nDeadline.isValid && nDeadline.normalized)
      ? nDeadline.normalized
      : rawDeadline;

    let isValid = row.isValid;
    let invalidReason = row.invalidReason || undefined;

    if (row.team_role && !teamRoleResult.isAllowed) {
      isValid = false;
      invalidReason = invalidReason
        ? `${invalidReason}; Invalid Team Role`
        : 'Invalid Team Role';
    }

    if (row.task_type && !taskTypeResult.isAllowed) {
      isValid = false;
      invalidReason = invalidReason
        ? `${invalidReason}; Invalid Task Type`
        : 'Invalid Task Type';
    }

    const newRow: PreparedRow = {
      ...row,
      dead_line,
      // Keep these as optional helpers for downstream tools and diagnostics.
      ...(nDeadline.isValid && nDeadline.normalized
        ? { dead_line_iso: nDeadline.normalized, dead_line_normalized: nDeadline.normalized }
        : {}),
      company: finalCompany,
      team_role: teamRoleResult.normalized,
      task_type: taskTypeResult.normalized,
      // v10.8 parity: recompute variation_seed using the single source of truth (engine/variationSeed.ts)
      // IMPORTANT: keep this strongly typed to prevent silent drift.
      variation_seed: computeVariationSeed({
        row_id: row.row_id,
        company: finalCompany,
        team_role: teamRoleResult.normalized,
        task_type: taskTypeResult.normalized,
        task_name: String(row.task_name || ''),
        dead_line,
        strategic_benefit: String(row.strategic_benefit || ''),
        output_metric: String(row.output_metric || ''),
        quality_metric: String(row.quality_metric || ''),
        improvement_metric: String(row.improvement_metric || '')
      } satisfies KpiRowIn),
      isValid,
      invalidReason
    };


    preparedRows.push(newRow);
  }

  const row_count = preparedRows.length;
  const invalid_row_count = preparedRows.filter((r) => !r.isValid).length;
  const valid_row_count = preparedRows.filter((r) => r.isValid).length;
  const needs_review_count = 0; // extension point

  const summary: BulkPrepareTokenPayload['summary'] = {
    row_count,
    invalid_row_count,
    has_company_column: summaryMeta.has_company_column,
    unique_companies: summaryMeta.unique_companies,
    missing_company_count: summaryMeta.missing_company_count,
    company_summary: summaryMeta.company_summary,
    company_decision_options: summaryMeta.company_decision_options,
    benefit_company_signals: summaryMeta.benefit_company_signals,
    company_case: summaryMeta.company_case,
    needs_company_decision: summaryMeta.needs_company_decision,
    has_invalid_rows: invalid_row_count > 0,
    state: 'READY_FOR_OBJECTIVES'
  };

  const prepPayload: BulkPrepareTokenPayload = {
    summary,
    preparedRows
  };

  const prep_token = encodePrepareToken(prepPayload);

  const ui_summary = `${row_count} row(s) ready for export (full validation runs during export).`;

  const response: BulkPrepareRowsResponse = {
    prep_token,
    state: 'READY_FOR_OBJECTIVES',
    row_count,
    valid_row_count,
    invalid_row_count,
    needs_review_count,
    ui_summary,
    prepared_rows: preparedRows
  };

  return res.status(200).json(response);
}