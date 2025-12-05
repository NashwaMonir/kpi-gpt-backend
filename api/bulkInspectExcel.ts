// api/bulkInspectExcel.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { bulkInspectCore } from '../engine/bulkInspectCore';
import { parseKpiInputExcelToJsonRows } from '../engine/parseKpiInputExcelToJsonRows';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * POST /api/bulkInspectExcel
 * Body: { file_id: string }
 * Used ONLY by the Custom GPT via the file handle.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const body = (req.body || {}) as { file_id?: string };
    const file_id = body.file_id;

    if (!file_id || typeof file_id !== 'string') {
      res.status(400).json({ error: 'file_id is required and must be a string.' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('bulkInspectExcel error: OPENAI_API_KEY not set');
      res
        .status(500)
        .json({ error: 'Bulk Excel processing failed (server): OPENAI_API_KEY not set' });
      return;
    }

    // 1) Download Excel file from OpenAI file storage
    const fileResponse = await openai.files.content(file_id);
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2) Parse Excel → KpiJsonRowIn[]
    const jsonRows = await parseKpiInputExcelToJsonRows(buffer);

    // 3) Run the same core inspector used by /api/bulkInspectJson
    const result = bulkInspectCore(jsonRows);

    res.status(200).json(result);
  } catch (err: any) {
    // Extract as much detail as possible
    const msg = err?.message || String(err);
    const status = err?.status ?? err?.response?.status;
    const data = err?.response?.data;

    console.error('bulkInspectExcel error:', {
      message: msg,
      status,
      data,
    });

    if (msg.includes('Bulk row limit exceeded')) {
      res.status(400).json({
        error: 'Bulk Excel processing failed (server): Bulk row limit exceeded.',
      });
      return;
    }

    // Return detailed message so we can see it via connector
    res.status(500).json({
      error: `Bulk Excel processing failed (server): ${msg}`,
    });
  }
}