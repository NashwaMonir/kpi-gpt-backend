import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs';
import path from 'path';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // repoRoot/public/KPI_Input_Template.xlsx
    const filePath = path.join(process.cwd(), 'public', 'KPI_Input_Template.xlsx');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Template file not found on server.' });
    }

    const buf = fs.readFileSync(filePath);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="KPI_Input_Template.xlsx"');
    res.setHeader('Content-Length', String(buf.length));

    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: 'Template download failed.' });
  }
}