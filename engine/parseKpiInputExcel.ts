// engine/parseKpiInputExcel.ts
// Deprecated: Excel parsing for KPI_Input is now handled in the GPT layer (Python → CSV → /api/bulkInspectJson).
// This stub is kept only to satisfy legacy imports during the transition.
// Do not use this function in new code.

export async function parseKpiInputExcel(_fileBuffer: Buffer): Promise<never> {
  throw new Error(
    'parseKpiInputExcel is deprecated. Bulk Excel input must go through the CSV-based flow via /api/bulkInspectJson.'
  );
}