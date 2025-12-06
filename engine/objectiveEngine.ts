// engine/objectiveEngine.ts

import type { PreparedRow, ObjectiveOutput } from './bulkTypes';

function buildSimpleObjective(row: PreparedRow): string {
  const deadline = row.dead_line || 'the agreed deadline';
  const base = `Deliver the ${row.task_name} ${row.task_type.toLowerCase()} by ${deadline}`;
  const metrics: string[] = [];

  if (row.output_metric) {
    metrics.push(row.output_metric);
  }
  if (row.quality_metric) {
    metrics.push(row.quality_metric);
  }
  if (row.improvement_metric) {
    metrics.push(row.improvement_metric);
  }

  const metricsClause = metrics.length > 0 ? ` with ${metrics.join(' and ')}` : '';

  return `${base}${metricsClause}.`;
}

function buildComplexObjective(row: PreparedRow): string {
  const deadline = row.dead_line || 'the agreed deadline';
  const base = `Deliver the ${row.task_name} ${row.task_type.toLowerCase()} by ${deadline}`;
  const clauses: string[] = [];

  if (row.output_metric) {
    clauses.push(row.output_metric);
  }
  if (row.quality_metric) {
    clauses.push(row.quality_metric);
  }
  if (row.improvement_metric) {
    clauses.push(row.improvement_metric);
  }

  const metricsClause =
    clauses.length > 0 ? `, achieving ${clauses.join(', and ')}` : '';

  const benefitClause = row.strategic_benefit
    ? `, aligned with ${row.company || 'the organization'}’s goal to ${row.strategic_benefit}`
    : '';

  return `${base}${metricsClause}${benefitClause}.`;
}

export function runObjectiveEngine(rows: PreparedRow[]): ObjectiveOutput[] {
  return rows.map((row) => {
    const simple_objective = buildSimpleObjective(row);
    const complex_objective = buildComplexObjective(row);

    return {
      row_id: row.row_id,
      simple_objective,
      complex_objective
    };
  });
}