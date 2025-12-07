// api/bulkInspect.ts
// Deprecated: Excel-based bulk inspect endpoint.
// New flow uses /api/bulkInspectJson with JSON rows for GPT and API clients.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(410).json({
    error:
      'The /api/bulkInspect endpoint is deprecated in v10.7.5. Use /api/bulkInspectJson with JSON rows instead.'
  });
}