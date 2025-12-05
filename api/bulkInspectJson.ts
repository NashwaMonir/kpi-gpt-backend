// api/bulkInspectJson.ts
// JSON-based bulk inspect endpoint for GPT and API clients.
// Accepts JSON rows instead of Excel. Applies row limit and returns rows_token.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { inspectJsonRowsForBulk } from '../engine/parseKpiInputJsonRows';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST with application/json.' });
    return;
  }

  try {
    const body = req.body as { rows?: unknown };

    if (!body || !Array.isArray(body.rows)) {
      res.status(400).json({ error: 'Invalid request: "rows" array is required.' });
      return;
    }

    const { summary } = inspectJsonRowsForBulk(body.rows);

    res.status(200).json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error in bulkInspectJson.';

    if (message.startsWith('Bulk row limit exceeded')) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
}