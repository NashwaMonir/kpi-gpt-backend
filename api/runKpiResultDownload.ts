// api/runKpiResultDownload.ts
// Download KPI_Output.xlsx from base64-encoded JSON rows in ?data=

import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';

interface KpiResultRow {
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;
  simple_objective: string;
  complex_objective: string;
  validation_status: string;
  comments: string;
  summary_reason: string;
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
      return parsed as KpiResultRow[];
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
    { header: 'Task Name', key: 'task_name', width: 40 },
    { header: 'Task Type', key: 'task_type', width: 18 },
    { header: 'Team Role', key: 'team_role', width: 18 },
    { header: 'Deadline', key: 'dead_line', width: 15 },
    { header: 'Simple Objective', key: 'simple_objective', width: 60 },
    { header: 'Complex Objective', key: 'complex_objective', width: 80 },
    { header: 'Validation Status', key: 'validation_status', width: 18 },
    { header: 'Comments', key: 'comments', width: 50 },
    { header: 'Summary Reason', key: 'summary_reason', width: 50 }
  ];

  for (const row of rows) {
    sheet.addRow({
      task_name: row.task_name ?? '',
      task_type: row.task_type ?? '',
      team_role: row.team_role ?? '',
      dead_line: row.dead_line ?? '',
      simple_objective: row.simple_objective ?? '',
      complex_objective: row.complex_objective ?? '',
      validation_status: row.validation_status ?? '',
      comments: row.comments ?? '',
      summary_reason: row.summary_reason ?? ''
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