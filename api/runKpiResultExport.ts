// api/runKpiResultExport.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createKpiResultWorkbook } from '../engine/excelExport';
import type { KpiResultExportRow } from '../engine/excelTypes';

type ExportRequestBody = {
  rows: KpiResultExportRow[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body: ExportRequestBody;

  // Parse JSON body (in case it's a string)
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as ExportRequestBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
    return res.status(400).json({ error: 'Payload must contain a non-empty rows array.' });
  }

  // Minimal structural validation so we don’t silently export broken data
  const requiredKeys: (keyof KpiResultExportRow)[] = [
    'task_name',
    'task_type',
    'team_role',
    'dead_line',
    'simple_objective',
    'complex_objective',
    'validation_status',
    'comments',
    'summary_reason'
  ];

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i];
    if (!row || typeof row !== 'object') {
      return res.status(400).json({ error: `Row at index ${i} is not an object.` });
    }

    for (const key of requiredKeys) {
      if (!(key in row)) {
        return res
          .status(400)
          .json({ error: `Row at index ${i} is missing required field: ${key}` });
      }
    }
  }

  try {
    const workbook = await createKpiResultWorkbook(body.rows);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="KPI_Output.xlsx"'
    );

    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('runKpiResultExport error', err);
    return res.status(500).json({ error: 'Failed to generate KPI result Excel file.' });
  }
}
