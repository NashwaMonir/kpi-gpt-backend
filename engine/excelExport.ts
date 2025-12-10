// engine/excelExport.ts
import ExcelJS from 'exceljs';
import type { KpiResultExportRow } from './excelTypes';

// -------------------------------
// Template workbook (KPI_Input)
// -------------------------------
export async function createKpiTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('KPI_Input');

  // Header row only (no row_id, no company)
  const headers = [
    'task_name',
    'task_type',
    'team_role',
    'dead_line',
    'strategic_benefit',
    'output_metric',
    'quality_metric',
    'improvement_metric'
  ];

  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  headers.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.max(header.length + 4, 16);
  });

  return workbook;
}

// -------------------------------
// Result workbook (KPI_Output)
// -------------------------------
export async function createKpiResultWorkbook(
  rows: KpiResultExportRow[]
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('KPI_Output');

  const headers = [
    'task_name',
    'task_type',
    'team_role',
    'dead_line',
    'objective',
    'validation_status',
    'comments',
    'summary_reason'
  ];

  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.task_name ?? '',
      row.task_type ?? '',
      row.team_role ?? '',
      row.dead_line ?? '',
      row.objective ?? '',
      row.validation_status ?? '',
      row.comments ?? '',
      row.summary_reason ?? ''
    ]);
  }

  // Auto width per column
  headers.forEach((header, index) => {
    const colIndex = index + 1;
    const column = sheet.getColumn(colIndex);

    let maxLength = header.length;
    column.eachCell({ includeEmpty: false }, cell => {
      const value = cell.value;
      const str = typeof value === 'string' ? value : value?.toString() ?? '';
      if (str.length > maxLength) maxLength = str.length;
    });

    column.width = Math.min(Math.max(maxLength + 4, 16), 80);
  });

  return workbook;
}
