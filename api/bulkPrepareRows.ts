// api/bulkPrepareRows.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getBulkSession, updateBulkPreparedRows } from '../engine/bulkSessionStore';
import type {
  BulkPrepareRowsRequest,
  BulkPrepareRowsResponse,
  BulkPreparedRow,
  ParsedRow
} from '../engine/bulkTypes';

function parseRequestBody(req: VercelRequest): Promise<BulkPrepareRowsRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(bodyStr) as BulkPrepareRowsRequest;
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

function applyCompanyStrategy(
  rows: ParsedRow[],
  selected_company: string,
  generic_mode: boolean,
  apply_to_missing: boolean,
  mismatched_strategy: 'keep' | 'overwrite'
): ParsedRow[] {
  if (generic_mode) {
    return rows.map((r) => ({
      ...r,
      company: null
    }));
  }

  const trimmedCompany = selected_company.trim();
  if (!trimmedCompany) {
    return rows;
  }

  return rows.map((r) => {
    const hasCompany = !!(r.company && r.company.trim().length > 0);

    if (!hasCompany && apply_to_missing) {
      return { ...r, company: trimmedCompany };
    }

    if (hasCompany && mismatched_strategy === 'overwrite') {
      return { ...r, company: trimmedCompany };
    }

    return r;
  });
}

function filterRowsByInvalidHandling(
  rows: ParsedRow[],
  invalid_handling: 'skip' | 'abort'
): { filtered: ParsedRow[]; aborted: boolean } {
  const hasInvalid = rows.some((r) => r.isValid === false);

  if (!hasInvalid) {
    return { filtered: rows, aborted: false };
  }

  if (invalid_handling === 'abort') {
    return { filtered: rows, aborted: true };
  }

  // invalid_handling === 'skip'
  const filtered = rows.filter((r) => r.isValid !== false);
  return { filtered, aborted: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = await parseRequestBody(req);
    const {
      bulk_session_id,
      selected_company,
      generic_mode,
      apply_to_missing,
      mismatched_strategy,
      invalid_handling
    } = body;

    const session = getBulkSession(bulk_session_id);
    if (!session) {
      return res.status(404).json({ error: 'Bulk session not found.' });
    }

    const baseRows: ParsedRow[] = session.rows;

    const companyAdjustedRows = applyCompanyStrategy(
      baseRows,
      selected_company,
      generic_mode,
      apply_to_missing,
      mismatched_strategy
    );

    const { filtered: rowsForPreparation, aborted } = filterRowsByInvalidHandling(
      companyAdjustedRows,
      invalid_handling
    );

    if (aborted) {
      const response: BulkPrepareRowsResponse = {
        bulk_session_id,
        state: 'INSPECTED',
        ui_summary:
          'Preparation aborted because some rows are invalid and invalid_handling was set to "abort".',
        rows: []
      };
      return res.status(200).json(response);
    }

    const preparedRows: BulkPreparedRow[] = rowsForPreparation.map((r) => ({
      row_id: r.row_id,
      company: r.company,
      team_role: r.team_role,
      task_type: r.task_type,
      task_name: r.task_name,
      dead_line: r.dead_line,
      strategic_benefit: r.strategic_benefit,
      output_metric: r.output_metric,
      quality_metric: r.quality_metric,
      improvement_metric: r.improvement_metric,
      mode: r.mode,
      isValid: r.isValid,
      invalidReason: r.invalidReason,
      status: r.isValid === false ? 'INVALID' : 'VALID',
      comments:
        r.isValid === false
          ? 'Row is invalid from Excel parsing.'
          : 'Pending KPI engine validation.',
      summary_reason:
        r.isValid === false ? 'Invalid mandatory fields in Excel row.' : '',
      errorCodes: [],
      resolved_metrics: null
    }));

    updateBulkPreparedRows(bulk_session_id, preparedRows);

    const response: BulkPrepareRowsResponse = {
      bulk_session_id,
      state: 'PREPARED',
      ui_summary: `Prepared ${preparedRows.length} row(s) for KPI objective generation.`,
      rows: preparedRows
    };

    return res.status(200).json(response);
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'bulkPrepareRows',
        event: 'unhandled_exception',
        message: err instanceof Error ? err.message : String(err)
      })
    );

    return res.status(500).json({ error: 'Internal bulkPrepareRows error.' });
  }
}