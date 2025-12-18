import type { VercelRequest, VercelResponse } from '@vercel/node';

// Deprecated in v10.8: template is now served as a static file.
// Clients must use: /templates/KPI_Input_Template.xlsx
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(410).json({
    error: 'Template download endpoint is deprecated.',
    hint: 'Use /templates/KPI_Input_Template.xlsx'
  });
}
