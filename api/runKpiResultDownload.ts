// api/runKpiResultDownload.ts
// Download KPI_Output.xlsx from base64-encoded JSON rows in ?data=

import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';

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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('KPI_Output');

  sheet.columns = [
    { header: 'Row ID', key: 'row_id', width: 10 },
    { header: 'Task Name', key: 'task_name', width: 40 },
    { header: 'Task Type', key: 'task_type', width: 18 },
    { header: 'Team Role', key: 'team_role', width: 18 },
    { header: 'Deadline', key: 'dead_line', width: 15 },
    { header: 'Objective', key: 'objective', width: 80 },
    { header: 'Output Metric', key: 'output_metric', width: 40 },
    { header: 'Quality Metric', key: 'quality_metric', width: 40 },
    { header: 'Improvement Metric', key: 'improvement_metric', width: 40 },
    { header: 'Metrics Auto-Suggested', key: 'metrics_auto_suggested', width: 22 },
    { header: 'Validation Status', key: 'validation_status', width: 18 },
    { header: 'Comments', key: 'comments', width: 50 }
  ];

  for (const row of rows) {
    sheet.addRow({
      row_id: row.row_id,
      task_name: row.task_name ?? '',
      task_type: row.task_type ?? '',
      team_role: row.team_role ?? '',
      dead_line: row.dead_line ?? '',
      objective: row.objective ?? '',
      output_metric: row.output_metric ?? '',
      quality_metric: row.quality_metric ?? '',
      improvement_metric: row.improvement_metric ?? '',
      metrics_auto_suggested: row.metrics_auto_suggested ? 'TRUE' : 'FALSE',
      validation_status: row.validation_status ?? '',
      comments: row.comments ?? ''
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

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