import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    team_role,
    task_type,
    task_name,
    dead_line,
    output_metric,
    quality_metric,
    improvement_metric,
    strategic_benefit
  } = req.body || {};

  if (!task_name || !dead_line) {
    return res.status(400).json({ error: 'Missing required fields: task_name, dead_line' });
  }

  const sentence = `By ${dead_line}, deliver the ${task_name} ${task_type?.toLowerCase() || 'task'} to achieve ${output_metric || 'the defined output metric'} with ${quality_metric || 'the agreed quality standard'}, and ${improvement_metric || 'the targeted improvement'}, supporting ${strategic_benefit || 'the organization’s strategic objectives'}.`;

  return res.status(200).json({
    status: 'ok',
    kpi_sentence: sentence
  });
}