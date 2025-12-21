import type { VercelRequest, VercelResponse } from '@vercel/node';

function getBaseUrl(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    (req.headers.host as string) ||
    'smart-kpi-api.vercel.app';
  return `${proto}://${host}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const baseUrl = getBaseUrl(req);
  const file_url = `${baseUrl}/public/KPI_Input_Template.xlsx`;

  return res.status(200).json({
    file_url,
    ui_message: 'KPI input template is ready. Click the link to download KPI_Input_Template.xlsx.',
  });
}