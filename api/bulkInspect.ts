// api/bulkInspect.ts
// Phase A: Upload & Inspect Excel (no objectives, no export)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { parseKpiInputExcel } from '../engine/parseKpiInputExcel';
import { saveBulkSession } from '../engine/bulkSessionStore';
import type {
  ParsedRow,
  BulkInspectSummary,
  BulkCompanyCase,
  BulkFlowState,
  BulkUiOption
} from '../engine/bulkTypes';

function analyzeCompanyCase(rows: ParsedRow[]): {
  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;
  company_case: BulkCompanyCase;
} {
  const companies = new Set<string>();
  let missing = 0;
  let hasAnyCompanyValue = false;

  for (const r of rows) {
    const c = (r.company ?? '').trim();
    if (!c) {
      missing++;
    } else {
      hasAnyCompanyValue = true;
      companies.add(c);
    }
  }

  const unique = Array.from(companies);
  const hasCompanyColumn = hasAnyCompanyValue || rows.some(r => r.company !== undefined);

  let company_case: BulkCompanyCase = 'NO_COLUMN';
  if (!hasCompanyColumn) {
    company_case = 'NO_COLUMN';
  } else if (unique.length <= 1) {
    company_case = 'SINGLE_COMPANY';
  } else {
    company_case = 'MULTI_COMPANY';
  }

  return {
    has_company_column: hasCompanyColumn,
    unique_companies: unique,
    missing_company_count: missing,
    company_case
  };
}

function buildUiForInspect(summary: {
  row_count: number;
  invalid_row_count: number;
  has_company_column: boolean;
  unique_companies: string[];
  missing_company_count: number;
  company_case: BulkCompanyCase;
}): {
  state: BulkFlowState;
  ui_prompt: string;
  options: BulkUiOption[];
} {
  const {
    row_count,
    invalid_row_count,
    has_company_column,
    unique_companies,
    missing_company_count,
    company_case
  } = summary;

  if (row_count === 0) {
    return {
      state: 'ABORT_EMPTY_FILE',
      ui_prompt:
        'The uploaded Excel file contains no KPI rows. Please upload a file with at least one row.',
      options: []
    };
  }

  // NO_COLUMN case
  if (!has_company_column || company_case === 'NO_COLUMN') {
    const prompt =
      `Your KPI file has ${row_count} row(s) and no company column. ` +
      `How do you want to handle the company name in the objectives?`;
    return {
      state: 'NEED_COMPANY_DECISION',
      ui_prompt: prompt,
      options: [
        {
          code: 'ONE_COMPANY_ALL',
          label: 'Use one company name for all rows'
        },
        {
          code: 'GENERIC_OBJECTIVES',
          label: 'Keep objectives generic (no company name)'
        },
        {
          code: 'REUPLOAD_WITH_COMPANY',
          label: 'Re-upload the file with a company column'
        }
      ]
    };
  }

  // SINGLE_COMPANY case
  if (company_case === 'SINGLE_COMPANY') {
    const company = unique_companies[0] ?? '';
    const basePrompt =
      `Your KPI file has ${row_count} row(s) and a single company in the column: "${company}".`;
    const invalidInfo =
      invalid_row_count > 0
        ? ` ${invalid_row_count} row(s) have missing mandatory fields.`
        : '';
    return {
      state: 'CONFIRM_SINGLE_COMPANY',
      ui_prompt:
        basePrompt +
        invalidInfo +
        ' Do you want to proceed with this company and optionally skip invalid rows, or re-upload the file?',
      options: [
        {
          code: 'USE_SHEET_COMPANY_SKIP_INVALID',
          label: 'Use the company from the sheet and skip invalid rows'
        },
        {
          code: 'USE_SHEET_COMPANY_ABORT_INVALID',
          label: 'Abort if there are invalid rows'
        },
        {
          code: 'REUPLOAD_WITH_COMPANY',
          label: 'Re-upload the file'
        }
      ]
    };
  }

  // MULTI_COMPANY case
  if (company_case === 'MULTI_COMPANY') {
    const companyList =
      unique_companies.length > 0 ? unique_companies.join(', ') : 'multiple values';
    const basePrompt =
      `Your KPI file has ${row_count} row(s) and multiple companies in the column: ${companyList}.`;
    const invalidInfo =
      invalid_row_count > 0
        ? ` ${invalid_row_count} row(s) have missing mandatory fields.`
        : '';
    return {
      state: 'NEED_MULTI_COMPANY_STRATEGY',
      ui_prompt:
        basePrompt +
        invalidInfo +
        ' How should company names be handled in the generated objectives?',
      options: [
        {
          code: 'KEEP_PER_ROW',
          label: 'Keep company values exactly as in the file'
        },
        {
          code: 'ONE_COMPANY_FOR_MISSING',
          label: 'Use one company only for rows with missing company'
        },
        {
          code: 'ONE_COMPANY_FOR_MISSING_AND_MISMATCHED',
          label: 'Use one company for missing and mismatched company rows'
        },
        {
          code: 'REUPLOAD_WITH_COMPANY',
          label: 'Re-upload the file'
        }
      ]
    };
  }

  // Fallback
  return {
    state: 'INVALID_ROWS_ACTION',
    ui_prompt:
      'The KPI file requires manual review before bulk processing. Please check the file and re-upload if necessary.',
    options: [
      {
        code: 'REUPLOAD_WITH_COMPANY',
        label: 'Re-upload the file'
      }
    ]
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body: any = req.body;

    if (!body || !body.file) {
      return res.status(400).json({
        error: 'Missing Excel file in request body.'
      });
    }

    const fileBuffer: Buffer =
      body.file instanceof Buffer ? body.file : Buffer.from(body.file, 'base64');

    const parsedRows = parseKpiInputExcel(fileBuffer);
    const row_count = parsedRows.length;

    const invalidRows = parsedRows.filter(
      r =>
        !r.team_role ||
        !r.task_type ||
        !r.task_name ||
        !r.dead_line ||
        !r.strategic_benefit
    );

    for (const r of parsedRows) {
      const isInvalid =
        !r.team_role || !r.task_type || !r.task_name || !r.dead_line || !r.strategic_benefit;
      r.isValid = !isInvalid;
      if (isInvalid) {
        r.invalidReason = 'Missing mandatory field(s).';
      }
    }

    const invalid_row_count = invalidRows.length;

    const companyAnalysis = analyzeCompanyCase(parsedRows);

    const basicSummary = {
      row_count,
      invalid_row_count,
      has_company_column: companyAnalysis.has_company_column,
      unique_companies: companyAnalysis.unique_companies,
      missing_company_count: companyAnalysis.missing_company_count,
      company_case: companyAnalysis.company_case as BulkCompanyCase
    };

    const ui = buildUiForInspect(basicSummary);

    const summary: BulkInspectSummary = {
      bulk_session_id: randomUUID(),
      row_count,
      invalid_row_count,
      has_company_column: companyAnalysis.has_company_column,
      unique_companies: companyAnalysis.unique_companies,
      missing_company_count: companyAnalysis.missing_company_count,
      benefit_company_signals: [],
      company_case: companyAnalysis.company_case,
      needs_company_decision:
        !companyAnalysis.has_company_column ||
        companyAnalysis.company_case === 'MULTI_COMPANY' ||
        companyAnalysis.company_case === 'NO_COLUMN',
      has_invalid_rows: invalid_row_count > 0,
      state: ui.state,
      ui_prompt: ui.ui_prompt,
      options: ui.options
    };

    saveBulkSession({
      summary,
      parsedRows
    });

    return res.status(200).json(summary);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'bulk-inspect',
        event: 'unhandled_exception',
        message: err instanceof Error ? err.message : String(err)
      })
    );

    return res.status(500).json({
      error: 'Internal bulkInspect error.'
    });
  }
}