// api/bulkInspect.ts
// Step 1: parse Excel → return rows_token + summary (stateless)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';
import { parseKpiInputExcel } from '../engine/parseKpiInputExcel';
import {
  ParsedRow,
  BulkInspectSummary,
  BulkInspectOption,
  BulkInspectTokenPayload,
  encodeInspectToken
} from '../engine/bulkTypes';

interface ParseResult {
  rows: ParsedRow[];
  row_count: number;
  invalid_row_count: number;

  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;

  benefit_company_signals: string[];

  company_case:
    | 'no_company_data'
    | 'single_company_column'
    | 'multi_company_column'
    | 'benefit_signal_only';

  needs_company_decision: boolean;
  has_invalid_rows: boolean;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST with multipart/form-data.' });
    return;
  }

  const bb = Busboy({ headers: req.headers as any });

  const chunks: Buffer[] = [];
  let hasFile = false;

  bb.on('file', (_name, file) => {
    hasFile = true;
    file.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
  });

  bb.on('error', (err: unknown) => {
    res.status(500).json({
      error: 'Internal bulkInspect error.',
      detail: String(err)
    });
  });

  bb.on('finish', async () => {
    if (!hasFile || chunks.length === 0) {
      res.status(400).json({
        error: 'Missing Excel file in request body.'
      });
      return;
    }

    try {
      const buffer = Buffer.concat(chunks);
      const parsed = (await parseKpiInputExcel(buffer)) as ParseResult;

      const options: BulkInspectOption[] = [];

      if (parsed.has_company_column) {
        options.push({
          code: 'use_sheet_company',
          label: 'Use the company from the sheet for all rows.'
        });
      }

      options.push({
        code: 'generic_mode',
        label: 'Ignore company and generate generic objectives.'
      });

      let ui_prompt = `Detected ${parsed.row_count} row(s).`;
      if (parsed.has_company_column && parsed.unique_companies.length === 1) {
        ui_prompt += ` All rows use company "${parsed.unique_companies[0]}".`;
      }
      ui_prompt += ' Choose how to proceed.';

      const summary: BulkInspectSummary = {
        row_count: parsed.row_count,
        invalid_row_count: parsed.invalid_row_count,

        has_company_column: parsed.has_company_column,
        unique_companies: parsed.unique_companies,
        missing_company_count: parsed.missing_company_count,

        benefit_company_signals: parsed.benefit_company_signals,

        company_case: parsed.company_case,
        needs_company_decision: parsed.needs_company_decision,
        has_invalid_rows: parsed.has_invalid_rows,

        state: 'INSPECTED',
        ui_prompt,
        options
      };

      const tokenPayload: BulkInspectTokenPayload = {
        parsedRows: parsed.rows,
        summary
      };

      const rows_token = encodeInspectToken(tokenPayload);

      res.status(200).json({
        rows_token,
        row_count: summary.row_count,
        invalid_row_count: summary.invalid_row_count,
        has_company_column: summary.has_company_column,
        unique_companies: summary.unique_companies,
        missing_company_count: summary.missing_company_count,
        benefit_company_signals: summary.benefit_company_signals,
        company_case: summary.company_case,
        needs_company_decision: summary.needs_company_decision,
        has_invalid_rows: summary.has_invalid_rows,
        state: summary.state,
        ui_prompt: summary.ui_prompt,
        options: summary.options
      });
    } catch (err) {
      const message = String(err);

      if (message.includes('Bulk row limit exceeded')) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({
        error: 'Internal bulkInspect error.',
        detail: message
      });
    }
  });

  (req as any).pipe(bb as any);
}