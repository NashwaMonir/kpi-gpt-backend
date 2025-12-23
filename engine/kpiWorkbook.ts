// engine/kpiWorkbook.ts
// Single source of truth for KPI_Output.xlsx schema (bulk + legacy download).

import ExcelJS from 'exceljs';
import type { KpiResultRow } from './bulkTypes';

export async function buildKpiOutputWorkbook(
  rows: KpiResultRow[],
  dateISO: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
    // Use dateISO to avoid unused parameter and to stamp workbook metadata (no UX columns added)
  const createdAt = new Date(`${dateISO}T00:00:00.000Z`);
  if (!Number.isNaN(createdAt.getTime())) {
    workbook.created = createdAt;
    workbook.modified = createdAt;
  }

  const sheet = workbook.addWorksheet('KPI_Output'); 

  // ✅ UX: No internal Row ID column
  sheet.columns = [
    { header: 'Task Name', key: 'task_name', width: 40 },
    { header: 'Task Type', key: 'task_type', width: 18 },
    { header: 'Team Role', key: 'team_role', width: 18 },
    { header: 'Deadline', key: 'dead_line', width: 15 },
    { header: 'Objective', key: 'objective', width: 80 },
    { header: 'Validation Status', key: 'validation_status', width: 18 },
    { header: 'Comments', key: 'comments', width: 50 }
  ];

  for (const row of rows) {
    sheet.addRow({
      task_name: row.task_name ?? '',
      task_type: row.task_type ?? '',
      team_role: row.team_role ?? '',
      dead_line: row.dead_line ?? '',
      objective: row.objective ?? '',
      validation_status: row.validation_status ?? '',
      comments: row.comments ?? ''
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as any);
}