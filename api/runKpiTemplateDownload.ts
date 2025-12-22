import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'node:fs';
import path from 'node:path';

// Streams the KPI input template as a real XLSX binary
// Source of truth: public/KPI_Input_Template.xlsx
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const filePath = path.join(process.cwd(), 'public', 'KPI_Input_Template.xlsx');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'Template file not found on server.',
      hint: 'Ensure public/KPI_Input_Template.xlsx exists in the deployed bundle.'
    });
  }

  const stat = fs.statSync(filePath);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="KPI_Input_Template.xlsx"'
  );
  res.setHeader('Content-Length', stat.size);

  // HEAD request: headers only
  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  // 🚨 THIS WAS MISSING — stream the binary
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}