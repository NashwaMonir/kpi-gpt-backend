import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE_URL = 'https://smart-kpi-api.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const fileUrl = `${BASE_URL}/api/runKpiTemplateDownload`;

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  return res.status(200).json({ 
    file_url: fileUrl, 
    ui_message:
      'KPI input template is ready. Click the link to download KPI_Input_Template.xlsx.'
  });
}