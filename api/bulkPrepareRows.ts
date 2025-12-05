// api/bulkPrepareRows.ts
// Step 2: rows_token + user options → prep_token + prepared_rows

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  BulkPrepareRowsRequest,
  BulkPrepareRowsResponse,
  BulkPreparedRow,
  RowsTokenPayload,
  BulkPrepareTokenPayload,
  decodeRowsToken,
  encodePrepareToken,
} from '../engine/bulkTypes';

function parseBody(req: VercelRequest): BulkPrepareRowsRequest {
  const body = req.body;
  if (!body) {
    return {} as BulkPrepareRowsRequest;
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as BulkPrepareRowsRequest;
    } catch {
      return {} as BulkPrepareRowsRequest;
    }
  }
  return body as BulkPrepareRowsRequest;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST with JSON body.' });
    return;
  }

  const reqBody = parseBody(req);
  const {
    rows_token,
    selected_company,
    generic_mode,
    apply_to_missing,
    mismatched_strategy,
    invalid_handling,
  } = reqBody;

  if (!rows_token || typeof rows_token !== 'string') {
    res.status(400).json({ error: 'Missing or invalid rows_token.' });
    return;
  }

  // Decode rows token (stateless)
  let payload: RowsTokenPayload;
  try {
    payload = decodeRowsToken(rows_token);
  } catch (err) {
    res.status(400).json({
      error: 'Failed to decode rows_token.',
      detail: String(err),
    });
    return;
  }

  const parsedRows = payload.parsedRows || [];
  const summaryMeta = payload.summaryMeta;

  // Company logic
  const finalCompany = generic_mode ? null : selected_company || null;
  const overwrite =
    !generic_mode && mismatched_strategy === 'overwrite' ? true : false;
  const applyMissing = apply_to_missing !== false; // default true

  const preparedRows: BulkPreparedRow[] = parsedRows.map((row) => {
    let company = row.company;

    if (generic_mode) {
      company = null;
    } else if (finalCompany) {
      if (!company && applyMissing) {
        company = finalCompany;
      } else if (company && overwrite) {
        company = finalCompany;
      }
    }

    return {
      ...row,
      company,
    };
  });

  const includeInvalid = invalid_handling === 'include';
  const rowsForObjectives = includeInvalid
    ? preparedRows
    : preparedRows.filter((r) => r.isValid !== false);

  const row_count = preparedRows.length;
  const invalid_row_count = preparedRows.length - rowsForObjectives.length;
  const valid_row_count = rowsForObjectives.length;

  const updatedSummary = {
    ...summaryMeta,
    state: 'READY_FOR_OBJECTIVES' as const,
  };

  const prepPayload: BulkPrepareTokenPayload = {
    summary: updatedSummary,
    preparedRows,
  };

  const prep_token = encodePrepareToken(prepPayload);

  const ui_summary = `${valid_row_count} row(s) ready for objective generation.`;

  const response: BulkPrepareRowsResponse = {
    prep_token,
    state: 'READY_FOR_OBJECTIVES',
    row_count,
    valid_row_count,
    invalid_row_count,
    needs_review_count: 0,
    ui_summary,
    prepared_rows: rowsForObjectives,
  };

  res.status(200).json(response);
}