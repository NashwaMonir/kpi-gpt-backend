// api/bulkInspectExcel.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { parseKpiInputExcelToJsonRows } from '../engine/parseKpiInputExcelToJsonRows';
import { bulkInspectCore } from '../engine/bulkInspectCore'; // wrapper around JSON inspection core

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { file_id } = req.body as { file_id?: string };

  if (!file_id || typeof file_id !== 'string') {
    return res.status(400).json({
      error: 'Invalid payload: \"file_id\" is required and must be a string.'
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not configured on the server.'
    });
  }

  try {
    // 1) Download Excel from OpenAI
    const fileResp = await openai.files.content(file_id);
    const arrayBuf = await (fileResp as any).arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // 2) Parse Excel → rows[]
    const rows = await parseKpiInputExcelToJsonRows(buffer);

    // 3) Hard limit (50 rows)
    const MAX_ROWS = 50;
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        error: `Bulk row limit exceeded. Max ${MAX_ROWS} rows allowed, found ${rows.length}.`
      });
    }

    // 4) Inspect using same JSON core
    const summary = bulkInspectCore(rows); // BulkInspectSummary

    return res.status(200).json(summary);
  } catch (err: any) {
    console.error('bulkInspectExcel error:', err);
    const msg = err?.message ?? String(err);

    if (msg.includes('Bulk row limit exceeded')) {
      return res.status(400).json({ error: msg });
    }

    return res.status(500).json({
      error: 'Bulk Excel file inspection failed.',
      details: msg
    });
  }
}