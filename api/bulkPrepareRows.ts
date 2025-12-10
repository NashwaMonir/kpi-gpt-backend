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
import { normalizeTeamRole, normalizeTaskType } from '../engine/normalizeFields';

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

  const invalid_handling = body.invalid_handling ?? 'skip';

  const preparedRows: PreparedRow[] = [];

  for (const row of parsedRows) {
    const finalCompany = applyCompanyStrategy(row, {
      selected_company: body.selected_company,
      generic_mode: body.generic_mode,
      apply_to_missing: body.apply_to_missing,
      mismatched_strategy: body.mismatched_strategy
    });

    // Normalize team_role and task_type using the same helpers as the single-row API.
    const teamRoleResult = normalizeTeamRole(row.team_role);
    const taskTypeResult = normalizeTaskType(row.task_type);

    let isValid = row.isValid;
    let invalidReason = row.invalidReason || undefined;

    if (!teamRoleResult.isAllowed) {
      isValid = false;
      invalidReason = invalidReason
        ? `${invalidReason}; Invalid Team Role`
        : 'Invalid Team Role';
    }

    if (!taskTypeResult.isAllowed) {
      isValid = false;
      invalidReason = invalidReason
        ? `${invalidReason}; Invalid Task Type`
        : 'Invalid Task Type';
    }

    const newRow: PreparedRow = {
      ...row,
      company: finalCompany,
      team_role: teamRoleResult.normalized,
      task_type: taskTypeResult.normalized,
      isValid,
      invalidReason
    };

    if (invalid_handling === 'skip' && !newRow.isValid) {
      continue;
    }

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
    benefit_company_signals: summaryMeta.benefit_company_signals,
    company_case: summaryMeta.company_case,
    needs_company_decision: summaryMeta.needs_company_decision,
    has_invalid_rows: summaryMeta.has_invalid_rows,
    state: 'READY_FOR_OBJECTIVES'
  };

  const prepPayload: BulkPrepareTokenPayload = {
    summary,
    preparedRows
  };

  const prep_token = encodePrepareToken(prepPayload);

  const ui_summary = `${row_count} row(s) ready for objective generation.`;

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