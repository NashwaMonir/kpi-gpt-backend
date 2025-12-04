// api/runKpiTemplateExport.ts
// Return a download_url for KPI input template, compatible with GPT tool.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET, POST, HEAD so Action.json (POST) and manual GET both work
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, POST, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const host = req.headers.host || 'smart-kpi-api.vercel.app';
  const download_url = `https://${host}/api/runKpiTemplateDownload`;

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  // JSON shape aligned with Action.json + GPT usage
  return res.status(200).json({
    download_url,
    file_url: download_url, // optional, for backward compatibility
    ui_message:
      'KPI input template is ready. Click the link to download KPI_Input_Template.xlsx.'
  });
}