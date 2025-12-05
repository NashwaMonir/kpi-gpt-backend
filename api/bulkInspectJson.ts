// api/bulkInspectJson.ts
//
// JSON-based bulk inspection endpoint (used by GPT when it already has rows[]).
// Now delegates to bulkInspectCore so Excel + JSON share exactly the same logic.

import type { NextApiRequest, NextApiResponse } from 'next';
import type { KpiJsonRowIn } from '../engine/bulkTypes';
import { bulkInspectCore } from '../engine/bulkInspectCore';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { rows } = req.body as { rows?: KpiJsonRowIn[] };

    if (!Array.isArray(rows)) {
      return res
        .status(400)
        .json({ error: 'Invalid payload: "rows" must be an array.' });
    }

    const result = await bulkInspectCore(rows);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('bulkInspectJson error:', err);
    return res.status(500).json({
      error: 'Bulk Excel JSON inspection failed.',
      details: err?.message ?? String(err),
    });
  }
}