// engine/bulkInspectCore.ts
//
// Shared inspection core used by both bulkInspectJson and bulkInspectExcel.
// It simply delegates to inspectJsonRowsForBulk, which already:
//  - validates max row count
//  - normalizes fields
//  - builds rows_token + BulkInspectSummary

import type { KpiJsonRowIn, BulkInspectSummary } from './bulkTypes';
import { inspectJsonRowsForBulk } from './parseKpiInputJsonRows';

export function bulkInspectCore(rows: KpiJsonRowIn[]): BulkInspectSummary {
  const { summary } = inspectJsonRowsForBulk(rows);
  return summary;
}