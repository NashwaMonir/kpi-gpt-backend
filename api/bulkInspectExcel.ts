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
    const { file_id } = req.body as { file_id?: string };

    if (!file_id || typeof file_id !== 'string') {
      res.status(400).json({ error: 'file_id is required and must be a string.' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      // Hard fail with explicit message for debugging
      console.error('Missing OPENAI_API_KEY in environment.');
      res.status(500).json({ error: 'Server configuration error: OPENAI_API_KEY not set.' });
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
    const message = err?.message || String(err);
    console.error('bulkInspectExcel error:', message);

    if (message.includes('Bulk row limit exceeded')) {
      res
        .status(400)
        .json({ error: 'Error: Bulk row limit exceeded. Max 50 rows allowed.' });
      return;
    }

    // Generic error, mapped to your BF0 fallback
    res.status(500).json({ error: 'Bulk Excel processing failed.' });
  }
}