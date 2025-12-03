// api/runKpiResultDownload.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createKpiResultWorkbook } from '../engine/excelExport'; // adjust name if different

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ error: 'Missing data parameter.' });
    }

    const raw = Array.isArray(data) ? data[0] : data;

    // Decode rows from base64-in-URL
    const json = Buffer.from(decodeURIComponent(raw), 'base64').toString('utf8');
    const rows = JSON.parse(json);

    const workbook = await createKpiResultWorkbook(rows);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="KPI_Output.xlsx"'
    );

    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('runKpiResultDownload error', err);
    return res.status(500).json({ error: 'Failed to generate KPI result Excel file.' });
  }
}