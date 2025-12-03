// api/runKpiResultExport.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE_URL = 'https://smart-kpi-api.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body as { rows?: unknown };

    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required.' });
    }

    const rows = body.rows;

    // Encode rows as base64 JSON and put in URL
    const json = JSON.stringify(rows);
    const base64 = Buffer.from(json, 'utf8').toString('base64');
    const encoded = encodeURIComponent(base64);

    const fileUrl = `${BASE_URL}/api/runKpiResultDownload?data=${encoded}`;

    return res.status(200).json({
      file_url: fileUrl
    });
  } catch (err) {
    console.error('runKpiResultExport error', err);
    return res.status(500).json({ error: 'Failed to prepare KPI result export URL.' });
  }
}