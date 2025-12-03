// engine/excelTypes.ts

// Validation status from your KPI Engine / buildErrorMessage layer
export type ValidationStatus = 'VALID' | 'NEEDS_REVIEW' | 'INVALID';

// Optional: shape of an input row for the Excel template (header-only in practice)
export interface KpiTemplateRow {
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;
  strategic_benefit: string;
  output_metric: string;
  quality_metric: string;
  improvement_metric: string;
  mode: string;
}

// Shape of each row that will go into KPI_Output.xlsx
// IMPORTANT: no row_id, no company.
export interface KpiResultExportRow {
  task_name: string;
  task_type: string;
  team_role: string;
  dead_line: string;

  simple_objective: string;
  complex_objective: string;

  validation_status: ValidationStatus;
  comments: string;
  summary_reason: string;
}
