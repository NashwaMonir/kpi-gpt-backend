import type { VercelRequest, VercelResponse } from '@vercel/node';

function getBaseUrl(req: VercelRequest): string {
  // Prefer explicit proto/host headers set by Vercel / proxies.
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined);

  // Fallback (should be rare): if host is missing, return empty string and let caller use relative.
  if (!host) return '';
  return `${proto}://${host}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const baseUrl = getBaseUrl(req);
  const file_url = baseUrl
    ? `${baseUrl}/api/runKpiTemplateDownload`
    : '/api/runKpiTemplateDownload';

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  return res.status(200).json({
    file_url,
    ui_message:
      'KPI input template is ready. Click the link to download KPI_Input_Template.xlsx.'
  });
}