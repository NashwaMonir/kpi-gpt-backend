import type { VercelRequest, VercelResponse } from '@vercel/node';

function getBaseUrl(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string);

  if (host && String(host).trim().length > 0) {
    return `${proto}://${host}`;
  }

  // Fallback (should rarely be used)
  return 'https://smart-kpi-api.vercel.app';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const baseUrl = getBaseUrl(req);
  const fileUrl = `${baseUrl}/api/runKpiTemplateDownload`;

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  return res.status(200).json({ 
    file_url: fileUrl, 
    ui_message:
      'KPI input template is ready. Click the link to download KPI_Input_Template.xlsx.'
  });
}