// scripts/golden_objectives.js
// Golden objective tests for SMART KPI Engine v10.8+ (enterprise objective quality lock)
// Node-only. Runs against the deployed API to validate:
//  - Objective quality clauses
//  - Single vs bulk parity (same input row must produce identical objective text)
//
// Run:
//   BASE_URL="https://<your-vercel-domain>" node scripts/golden_objectives.js
// Or uses default preview domain if BASE_URL is not provided.

const BASE_URL =
  process.env.BASE_URL ||
  'https://kpi-gpt-backend-git-chore-depend-f257e6-nashwa-mounirs-projects.vercel.app';

const ENGINE_VERSION = process.env.ENGINE_VERSION || 'v10.8';

const BANNED = [
  /auto-suggest/i,
  /auto suggest/i,
  /strengthen supporting/i,
  /\bwhile\b([^.]*)\bwhile\b/i
];

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hasBaseline(text) {
  return /\bmeasured\s+against\b/i.test(text);
}

function isLeadRole(teamRole) {
  return String(teamRole || '').toLowerCase().includes('lead');
}

function hasGovRisk(text) {
  const hasGov =
    /\bgovernance\b/i.test(text) ||
    /\benforc(e|ing)\b/i.test(text) ||
    /\binstitutionaliz(e|ing)\b/i.test(text) ||
    /\bestablish\b/i.test(text);
  const hasRisk =
    /\bdependency\b/i.test(text) ||
    /\brisk\b/i.test(text) ||
    /\bescalat(e|ion)\b/i.test(text) ||
    /\bmitigat(e|ion)\b/i.test(text);
  return hasGov && hasRisk;
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    json = { raw: txt };
  }

  if (!res.ok) {
    const bodyPreview = (() => {
      try {
        const s = JSON.stringify(body);
        return s.length > 600 ? s.slice(0, 600) + '…' : s;
      } catch {
        return '[unserializable body]';
      }
    })();
    throw new Error(`${path} HTTP ${res.status}: ${txt}\nREQUEST_BODY: ${bodyPreview}`);
  }

  return json;
}

function pickObjectiveFromSingle(singleJson, mode) {
  // Tolerant parsing: support different response shapes.
  const rows = singleJson?.rows;
  const first = Array.isArray(rows) ? rows[0] : null;
  const row = first || singleJson?.row || singleJson;

  const simple = row?.simple_objective || row?.simpleObjective || row?.objective_simple || '';
  const complex = row?.complex_objective || row?.complexObjective || row?.objective_complex || row?.objective || '';
  return norm(mode === 'simple' ? simple : complex);
}

function pickObjectiveFromBulkFinalize(finalizeJson, mode) {
  // Tolerant parsing for bulk finalize responses.
  const rows = finalizeJson?.rows || finalizeJson?.final_rows || finalizeJson?.final_rows_preview || finalizeJson?.prepared_rows || finalizeJson?.result_rows;
  const first = Array.isArray(rows) ? rows[0] : null;
  const row = first || finalizeJson?.row || finalizeJson;

  const simple = row?.simple_objective || row?.simpleObjective || row?.objective_simple || '';
  const complex = row?.complex_objective || row?.complexObjective || row?.objective_complex || row?.objective || '';
  return norm(mode === 'simple' ? simple : complex);
}

async function callSingleKpi(row) {
  return post('/api/kpi', {
    engine_version: ENGINE_VERSION,
    rows: [row]
  });
}

async function callBulkFlow(row) {
  // 1) inspect
  const inspected = await post('/api/bulkInspectJson', {
    engine_version: ENGINE_VERSION,
    rows: [row]
  });

  const rows_token = inspected?.rows_token || inspected?.token || '';
  const inspectedRows = inspected?.rows || inspected?.rows_preview || [row];
  const company =
    (inspected?.unique_companies && inspected.unique_companies[0]) ||
    row.company ||
    (inspectedRows[0] && inspectedRows[0].company) ||
    '';

  // 2) prepare (token-based)
  const prepared = await post('/api/bulkPrepareRows', {
    engine_version: ENGINE_VERSION,
    rows_token,
    company
  });

  const prepared_rows = prepared?.prepared_rows;
  const prepared_rows_token = prepared?.prepared_rows_token || prepared?.rows_token || rows_token;

  // 3) finalize (prefer prepared_rows if returned; otherwise token)
  const finalizeBody = {
    engine_version: ENGINE_VERSION
  };
  if (Array.isArray(prepared_rows) && prepared_rows.length) {
    finalizeBody.prepared_rows = prepared_rows;
  } else {
    finalizeBody.rows_token = prepared_rows_token;
  }

  const finalized = await post('/api/bulkFinalizeExport', finalizeBody);

  return finalized;
}

function validateObjective(tcId, objective, expect) {
  assert(objective.length > 30, `${tcId}: objective empty/too short`);

  for (const re of BANNED) {
    assert(!re.test(objective), `${tcId}: banned phrase/pattern matched: ${re}`);
  }

  for (const re of expect.mustInclude || []) {
    assert(re.test(objective), `${tcId}: missing required clause: ${re}`);
  }

  for (const re of expect.mustNotInclude || []) {
    assert(!re.test(objective), `${tcId}: contains forbidden clause: ${re}`);
  }

  if (expect.baselineRequired) {
    assert(hasBaseline(objective), `${tcId}: missing baseline clause in complex objective`);
  }

  if (expect.governanceRiskRequired) {
    assert(hasGovRisk(objective), `${tcId}: missing governance + risk/dependency language for lead complex`);
  }
}

const cases = [
  // 1) Design IC simple (all metrics)
  {
    id: 'design_ic_simple_all_metrics',
    row: {
      row_id: 101,
      company: 'Acme Corp',
      team_role: 'Design',
      task_type: 'Project',
      task_name: 'Homepage redesign',
      dead_line: '2025-10-01',
      strategic_benefit: 'Enhance the organization’s digital presence.',
      output_metric: 'Reduce task-completion time by 20%',
      quality_metric: 'Maintain ≥95% WCAG 2.1 AA compliance',
      improvement_metric: 'Increase task-success rate to ≥90%'
    },
    expect: {
      mode: 'simple',
      lead: false,
      baselineRequired: false,
      governanceRiskRequired: false,
      mustInclude: [/^By\s+2025-10-01,/i]
    }
  },

  // 2) Design IC complex (missing metric)
  {
    id: 'design_ic_complex_missing_metric',
    row: {
      row_id: 102,
      company: 'Acme Corp',
      team_role: 'Design',
      task_type: 'Project',
      task_name: 'Checkout flow improvements',
      dead_line: '2025-12-31',
      strategic_benefit: 'Improve digital customer experience across core journeys.',
      output_metric: 'Reduce task-completion time by 20%',
      quality_metric: 'Maintain ≥95% WCAG 2.1 AA compliance'
      // improvement_metric missing -> should become complex
    },
    expect: {
      mode: 'complex',
      lead: false,
      baselineRequired: true,
      governanceRiskRequired: false,
      mustInclude: [/^By\s+2025-12-31,/i, /measured\s+against/i]
    }
  },

  // 3) Design Lead complex (all metrics but lead)
  {
    id: 'design_lead_complex_all_metrics',
    row: {
      row_id: 103,
      company: 'Acme Corp',
      team_role: 'Design Lead',
      task_type: 'Project',
      task_name: 'Design governance rollout',
      dead_line: '2025-12-31',
      strategic_benefit: 'Strengthen governance and cross-functional alignment across squads.',
      output_metric: 'Achieve ≥96% multi-squad design consistency',
      quality_metric: 'Reduce design-related defects by 30%',
      improvement_metric: 'Maintain stakeholder satisfaction ≥4.2/5'
    },
    expect: {
      mode: 'complex',
      lead: true,
      baselineRequired: true,
      governanceRiskRequired: true,
      mustInclude: [/^By\s+2025-12-31,/i, /measured\s+against/i]
    }
  },

  // 4) Dev IC simple + security baseline
  {
    id: 'dev_ic_simple_security',
    row: {
      row_id: 104,
      company: 'Acme Corp',
      team_role: 'Development',
      task_type: 'Change Request',
      task_name: 'Security hardening for API services',
      dead_line: '2025-09-30',
      strategic_benefit: 'Strengthen security, privacy, and compliance posture.',
      output_metric: 'Close security vulnerabilities within 7 days of detection',
      quality_metric: 'Deliver with ≤2% high-severity defects',
      improvement_metric: 'Increase automated test coverage to ≥90%'
    },
    expect: {
      mode: 'simple',
      lead: false,
      baselineRequired: false,
      governanceRiskRequired: false,
      mustInclude: [/^By\s+2025-09-30,/i]
    }
  },

  // 5) Dev Lead complex (incident/MTTR)
  {
    id: 'dev_lead_complex_incident_mttr',
    row: {
      row_id: 105,
      company: 'Acme Corp',
      team_role: 'Development Lead',
      task_type: 'Project',
      task_name: 'Reliability and incident reduction program',
      dead_line: '2025-12-31',
      strategic_benefit: 'Improve platform reliability and service continuity.',
      output_metric: 'Reduce production incidents by 30%',
      quality_metric: 'Achieve ≥95% adherence to architectural standards',
      improvement_metric: 'Decrease MTTR by 20%'
    },
    expect: {
      mode: 'complex',
      lead: true,
      baselineRequired: true,
      governanceRiskRequired: true,
      mustInclude: [/^By\s+2025-12-31,/i, /measured\s+against/i]
    }
  },

  // 6) Content IC simple (CTR/time on page)
  {
    id: 'content_ic_simple_ctr_time',
    row: {
      row_id: 106,
      company: 'Acme Corp',
      team_role: 'Content',
      task_type: 'Project',
      task_name: 'Landing page content optimization',
      dead_line: '2025-12-31',
      strategic_benefit: 'Increase conversion and self-service adoption.',
      output_metric: 'Increase CTR by 20%',
      quality_metric: 'Achieve ≥95% style-guide compliance',
      improvement_metric: 'Increase average time on page by 15%'
    },
    expect: {
      mode: 'simple',
      lead: false,
      baselineRequired: false,
      governanceRiskRequired: false,
      mustInclude: [/^By\s+2025-12-31,/i]
    }
  },

  // 7) Content Lead complex (governance + legal)
  {
    id: 'content_lead_complex_governance_legal',
    row: {
      row_id: 107,
      company: 'Acme Corp',
      team_role: 'Content Lead',
      task_type: 'Project',
      task_name: 'Enterprise content governance',
      dead_line: '2025-12-31',
      strategic_benefit: 'Ensure compliant and unified communication across channels.',
      output_metric: 'Increase style-guide compliance to ≥96%',
      quality_metric: 'Reduce cross-channel inconsistencies by 40%',
      improvement_metric: 'Shorten production cycle time by 20%'
    },
    expect: {
      mode: 'complex',
      lead: true,
      baselineRequired: true,
      governanceRiskRequired: true,
      mustInclude: [/^By\s+2025-12-31,/i, /measured\s+against/i, /Legal/i]
    }
  }
];

async function main() {
  console.log(`BASE_URL = ${BASE_URL}`);
  console.log(`ENGINE_VERSION = ${ENGINE_VERSION}`);

  const failures = [];

  for (const tc of cases) {
    try {
      // Sanity: lead expectation
      assert(isLeadRole(tc.row.team_role) === tc.expect.lead, `${tc.id}: lead expectation mismatch`);

      const singleJson = await callSingleKpi(tc.row);
      const bulkJson = await callBulkFlow(tc.row);

      const singleObj = pickObjectiveFromSingle(singleJson, tc.expect.mode);
      const bulkObj = pickObjectiveFromBulkFinalize(bulkJson, tc.expect.mode);

      assert(singleObj, `${tc.id}: single objective missing (check /api/kpi response shape)`);
      assert(bulkObj, `${tc.id}: bulk objective missing (check /api/bulkFinalizeExport response shape)`);

      // Parity requirement
      assert(
        singleObj === bulkObj,
        `${tc.id}: single vs bulk objective mismatch\nS: ${singleObj}\nB: ${bulkObj}`
      );

      // Quality checks
      validateObjective(tc.id, singleObj, tc.expect);

      console.log(`PASS: ${tc.id}`);
    } catch (e) {
      failures.push(`${tc.id}: ${e.message || e}`);
      console.error(`FAIL: ${tc.id}\n${e.message || e}`);
    }
  }

  if (failures.length) {
    console.error(`\nGolden tests FAILED (${failures.length}):\n- ` + failures.join('\n- '));
    process.exit(1);
  }

  console.log('\nGolden tests PASSED.');
  process.exit(0);
}

main().catch((e) => {
  console.error(`FATAL: ${e?.message || e}`);
  process.exit(1);
});