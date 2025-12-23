// api/runKpiResultDownload.ts
// Download KPI_Output.xlsx from base64-encoded JSON rows in ?data=

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildKpiOutputWorkbook } from '../engine/kpiWorkbook';

interface KpiResultRow {
  row_id: number;
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;
  /**
   * Final, authoritative objective selected by the engine
   * (simple or complex, depending on the contract rules).
   */
  objective: string;
  validation_status: 'VALID' | 'NEEDS_REVIEW' | 'INVALID';
  comments: string;
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;
  metrics_auto_suggested: boolean;
}

function normalizeStatus(v: unknown): 'VALID' | 'NEEDS_REVIEW' | 'INVALID' {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'VALID') return 'VALID';
  if (s === 'NEEDS_REVIEW' || s === 'NEEDS REVIEW') return 'NEEDS_REVIEW';
  return 'INVALID';
}

function decodeRowsFromQuery(dataParam: string | string[] | undefined): KpiResultRow[] {
  if (!dataParam) return [];

  const raw =
    Array.isArray(dataParam) ? dataParam[0] : dataParam;

  if (!raw) return [];

  // raw is base64 or base64url; normalize base64url just in case
  let base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';

  const json = Buffer.from(base64, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return (parsed as any[]).map((r) => ({
        row_id: Number(r?.row_id ?? 0),
        task_name: String(r?.task_name ?? ''),
        task_type: String(r?.task_type ?? ''),
        team_role: String(r?.team_role ?? ''),
        dead_line: String(r?.dead_line ?? ''),
        objective: String(r?.objective ?? ''),
        validation_status: normalizeStatus(r?.validation_status),
        comments: String(r?.comments ?? ''),
        output_metric: String(r?.output_metric ?? ''),
        quality_metric: String(r?.quality_metric ?? ''),
        improvement_metric: String(r?.improvement_metric ?? ''),
        metrics_auto_suggested: Boolean(r?.metrics_auto_suggested)
      })) as KpiResultRow[];
    }
    return [];
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET with ?data=...' });
    return;
  }

  const rows = decodeRowsFromQuery(req.query.data);
  if (!rows.length) {
    res
      .status(400)
      .json({ error: 'Missing or invalid data parameter for KPI result download.' });
    return;
  }

  const dateISO = new Date().toISOString().slice(0, 10);
  const buffer = await buildKpiOutputWorkbook(rows as any, dateISO);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="KPI_Output.xlsx"'
  );

  res.status(200).send(Buffer.from(buffer));
}