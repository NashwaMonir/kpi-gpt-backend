// api/bulkInspect.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';

import { parseKpiInputExcel } from '../engine/parseKpiInputExcel';
import { saveBulkSession } from '../engine/bulkSessionStore';
import type { BulkInspectSummary } from '../engine/bulkTypes';

function readExcelFileFromMultipart(
  req: VercelRequest,
  fieldName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Busboy is a function in your runtime, not a constructor
    const bb = Busboy({ headers: req.headers as any }) as any;

    const chunks: Buffer[] = [];
    let hasTargetFile = false;

    bb.on('file', (name: string, file: NodeJS.ReadableStream) => {
      if (name !== fieldName) {
        file.resume();
        return;
      }

      hasTargetFile = true;

      file.on('data', (chunk: any) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
      });

      file.on('end', () => {
        // no-op; we concat on 'finish'
      });
    });

    bb.on('finish', () => {
      if (!hasTargetFile) {
        return reject(new Error('Missing Excel file in request body.'));
      }
      const buf = Buffer.concat(chunks);
      if (!buf.length) {
        return reject(new Error('Missing Excel file in request body.'));
      }
      resolve(buf);
    });

    bb.on('error', (err: Error) => {
      reject(err);
    });

    req.pipe(bb);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const fileBuffer = await readExcelFileFromMultipart(req, 'file');

    const parsed = parseKpiInputExcel(fileBuffer);

    const bulk_session_id = saveBulkSession({
      state: 'INSPECTED',
      rows: parsed.rows,
      meta: {
        row_count: parsed.row_count,
        invalid_row_count: parsed.invalid_row_count,
        has_company_column: parsed.has_company_column,
        unique_companies: parsed.unique_companies,
        missing_company_count: parsed.missing_company_count,
        benefit_company_signals: parsed.benefit_company_signals,
        company_case: parsed.company_case,
        needs_company_decision: parsed.needs_company_decision,
        has_invalid_rows: parsed.has_invalid_rows
      }
    });

    const summary: BulkInspectSummary = {
      bulk_session_id,
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
      ui_prompt: parsed.ui_prompt,
      options: parsed.options
    };

    return res.status(200).json(summary);
  } catch (err: any) {
    if (err instanceof Error && err.message === 'Missing Excel file in request body.') {
      return res.status(400).json({ error: 'Missing Excel file in request body.' });
    }

    console.error(
      JSON.stringify({
        level: 'error',
        service: 'bulkInspect',
        event: 'unhandled_exception',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      })
    );

    return res.status(500).json({
      error: 'Internal bulkInspect error.',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
}