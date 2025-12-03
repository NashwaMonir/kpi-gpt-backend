// api/runKpiTemplateExport.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createKpiTemplateWorkbook } from '../engine/excelExport';

export default async function handler(req: VercelRequest, res: VercelResponse) {
 if (req.method !== 'GET' && req.method !== 'HEAD') {
  res.setHeader('Allow', 'GET, HEAD');
  return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const workbook = await createKpiTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="KPI_Input_Template.xlsx"'
    );

    // For HEAD, just send headers and 200, no body
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('runKpiTemplateExport error', err);
    return res.status(500).json({ error: 'Failed to generate template Excel file.' });
  }
}
