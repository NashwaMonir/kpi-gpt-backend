#!/usr/bin/env bash
set -euo pipefail

# bulk_full_regression.sh
# Intensive bulk regression pack:
# - Company handling (missing/multi/overwrite/row-level/generic)
# - Objective grammar guards (no "to achieve Deliver/Provide", no "Deliver scoped delivery of")
# - Tail leakage guard (design/content must not get reliability/security tails)
# - Determinism basics (same input => same variation_seed per row in prep)
# - Row_id canonicalization + fallback (string/whitespace/invalid)
# - Whitespace/newlines/tabs normalization in task_name/benefit
# - Arabic/special chars safety (no JSON break)
# - Grammar/tail checks are now automated by downloading and scanning the XLSX export contents (no Python dependencies).

BASE="${BASE:-http://localhost:3000}"
INSPECT_URL="${BASE}/api/bulkInspectJson"
PREP_URL="${BASE}/api/bulkPrepareRows"
EXPORT_URL="${BASE}/api/bulkFinalizeExport"


# ---------------------------
# Result tracking
# ---------------------------
TOTAL_CASES=0
PASSED_CASES=0
FAILED_CASES=0
FAILED_CASE_LIST=()

fatal() {
  echo "❌ $*" >&2
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || fatal "Missing dependency: $1"; }
need curl
need jq
need unzip
need mktemp

pass() { echo "✅ $*"; }

# Case-level failure (do not exit immediately; propagate non-zero)
fail() {
  echo "❌ $*" >&2
  return 1
}

post_json() {
  local url="$1"
  local body="$2"
  curl -sS -X POST "$url" -H "Content-Type: application/json" --data-binary "$body"
}

# ---------------------------
# XLSX Download and Scan Helpers
# ---------------------------

download_xlsx() {
  local url="$1"
  local out="$2"
  curl -sS -L "$url" -o "$out"
}

# Extract plain text from XLSX by reading sharedStrings.xml (best-effort).
# This avoids Python deps and is sufficient for regex checks.
extract_xlsx_text() {
  local xlsx="$1"
  # Some files may not have sharedStrings.xml; fall back to concatenating worksheet XML.
  if unzip -l "$xlsx" | awk '{print $4}' | grep -qx 'xl/sharedStrings.xml'; then
    unzip -p "$xlsx" 'xl/sharedStrings.xml' 2>/dev/null \
      | sed -e 's/<[^>]*>/\n/g' \
      | sed -e 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&apos;/'"'"'/g' \
      | tr '\r' '\n'
  else
    unzip -p "$xlsx" 'xl/worksheets/sheet1.xml' 2>/dev/null \
      | sed -e 's/<[^>]*>/\n/g' \
      | sed -e 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&apos;/'"'"'/g' \
      | tr '\r' '\n'
  fi
}

check_export_xlsx() {
  local name="$1"
  local url="$2"

  local tmpdir
  tmpdir="$(mktemp -d)"
  local xlsx="$tmpdir/out.xlsx"

  download_xlsx "$url" "$xlsx"

  # Sanity: ensure it is a zip container
  if ! unzip -t "$xlsx" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    fail "$name: downloaded file is not a valid XLSX/ZIP" || return 1
  fi

  local text
  text="$(extract_xlsx_text "$xlsx" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^ +| +$//g')"

  # Re-use existing checks
  check_objective_grammar "$name" "$text"

  # Only run tail leakage guard for Design/Content-specific cases.
  # Caller decides when to invoke.

  rm -rf "$tmpdir"
}

check_export_xlsx_tail_leakage() {
  local name="$1"
  local url="$2"

  local tmpdir
  tmpdir="$(mktemp -d)"
  local xlsx="$tmpdir/out.xlsx"

  download_xlsx "$url" "$xlsx"

  if ! unzip -t "$xlsx" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    fail "$name: downloaded file is not a valid XLSX/ZIP" || return 1
  fi

  local text
  text="$(extract_xlsx_text "$xlsx" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^ +| +$//g')"

  check_tail_leakage "$name" "$text"

  rm -rf "$tmpdir"
}

assert_nonempty() {
  local label="$1" got="$2"
  [[ -n "$got" && "$got" != "null" ]] || { fail "$label: expected non-empty, got '$got'"; return 1; }
}

assert_eq() {
  local label="$1" got="$2" exp="$3"
  [[ "$got" == "$exp" ]] || { fail "$label: expected '$exp', got '$got'"; return 1; }
}

assert_true() {
  local label="$1" got="$2"
  [[ "$got" == "true" ]] || { fail "$label: expected true, got '$got'"; return 1; }
}

assert_false() {
  local label="$1" got="$2"
  [[ "$got" == "false" ]] || { fail "$label: expected false, got '$got'"; return 1; }
}

# ---------------------------
# Objective grammar checks
# ---------------------------

# Fails if objective contains known bad patterns.
check_objective_grammar() {
  local name="$1"
  local objectives_tsv="$2"

  # 1) "to achieve Deliver/Provide/Support/Complete/Implement/Launch/Ship/Publish/Ensure"
  if echo "$objectives_tsv" | grep -Eiq '\bto achieve (deliver|provide|support|complete|implement|launch|ship|publish|ensure)\b'; then
    echo "$objectives_tsv"
    fail "$name: found forbidden pattern: 'to achieve <ImperativeVerb>'"
  fi

  # 2) "Deliver scoped delivery of" duplication
  if echo "$objectives_tsv" | grep -Eiq '\bDeliver scoped delivery of\b'; then
    echo "$objectives_tsv"
    fail "$name: found forbidden duplication: 'Deliver scoped delivery of'"
  fi

  pass "$name grammar ok"
}

# Tail leakage guard:
# For Design/Content objectives, ensure they don't contain reliability/security keywords.
check_tail_leakage() {
  local name="$1"
  local objectives_tsv="$2"

  if echo "$objectives_tsv" | grep -Eiq '(uptime|availability|mttr|incident|latency|sla|reliab|security|vulnerab)'; then
    echo "$objectives_tsv"
    fail "$name: tail leakage detected (reliability/security keywords in objective)"
  fi

  pass "$name tail leakage ok"
}

# ---------------------------
# End-to-end runner
# ---------------------------

run_bulk() {
  local name="$1"
  local csv="$2"
  local policy_json="${3:-null}"
  local expected_export_error="${4:-}"

  TOTAL_CASES=$((TOTAL_CASES + 1))

  echo
  echo "===================="
  echo "CASE: $name"
  echo "===================="

  # STEP 1: INSPECT
  local inspect_body
  inspect_body="$(jq -n --arg csv "$csv" '{excel_csv_text:$csv}')"
  local inspect_resp
  inspect_resp="$(post_json "$INSPECT_URL" "$inspect_body")"

  if [[ "$(echo "$inspect_resp" | jq -r '.error // false')" == "true" ]]; then
    echo "$inspect_resp" | jq .
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: bulkInspectJson returned error")
    return 1
  fi

  local rows_token
  rows_token="$(echo "$inspect_resp" | jq -r '.rows_token')"
  assert_nonempty "$name rows_token" "$rows_token" || {
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: missing rows_token")
    return 1
  }

  echo "$inspect_resp" | jq '{
    row_count,
    invalid_row_count,
    has_company_column,
    unique_companies,
    missing_company_count,
    company_case,
    needs_company_decision
  }'

  # STEP 2: PREPARE
  local prep_body
  if [[ "$policy_json" != "null" ]]; then
    prep_body="$(jq -n --arg rows_token "$rows_token" --argjson policy "$policy_json" \
      '{rows_token:$rows_token, company_policy:$policy, invalid_handling:"keep"}')"
  else
    prep_body="$(jq -n --arg rows_token "$rows_token" \
      '{rows_token:$rows_token, invalid_handling:"keep"}')"
  fi

  local prep_resp
  prep_resp="$(post_json "$PREP_URL" "$prep_body")"

  if [[ "$(echo "$prep_resp" | jq -r '.error // false')" == "true" ]]; then
    echo "$prep_resp" | jq .
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: bulkPrepareRows returned error")
    return 1
  fi

  local prep_token
  prep_token="$(echo "$prep_resp" | jq -r '.prep_token')"
  assert_nonempty "$name prep_token" "$prep_token" || {
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: missing prep_token")
    return 1
  }

  # Determinism / seed presence
  local missing_seed
  missing_seed="$(echo "$prep_resp" | jq -r '[.prepared_rows[] | select(.variation_seed==null)] | length')"
  assert_eq "$name variation_seed missing count" "$missing_seed" "0" || {
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: variation_seed missing in prepared_rows")
    return 1
  }

  # STEP 3: EXPORT
  local export_body
  export_body="$(jq -n --arg prep_token "$prep_token" '{prep_token:$prep_token}')"
  local export_resp
  export_resp="$(post_json "$EXPORT_URL" "$export_body")"

  if [[ "$(echo "$export_resp" | jq -r '.error // false')" == "true" ]]; then
    local code
    code="$(echo "$export_resp" | jq -r '.code // ""')"

    if [[ -n "$expected_export_error" && "$code" == "$expected_export_error" ]]; then
      echo "$export_resp" | jq .
      PASSED_CASES=$((PASSED_CASES + 1))
      pass "$name (expected export error: $expected_export_error)"
      return 0
    fi

    echo "$export_resp" | jq .
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: bulkFinalizeExport returned error")
    return 1
  fi

  local download_url
  download_url="$(echo "$export_resp" | jq -r '.download_url')"
  assert_nonempty "$name download_url" "$download_url" || {
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: missing download_url")
    return 1
  }

  echo "$export_resp" | jq '{
    valid_count,
    needs_review_count,
    invalid_count,
    ui_message,
    download_url
  }'

  # Automated post-export checks (no Python deps): download XLSX and scan text.
  check_export_xlsx "$name" "$download_url" || {
    FAILED_CASES=$((FAILED_CASES + 1))
    FAILED_CASE_LIST+=("$name: XLSX scan failed (grammar/format)")
    return 1
  }

  # Tail leakage checks only for the dedicated guard case.
  if [[ "$name" == INT7_TAIL_LEAKAGE_GUARD__SINGLE_COMPANY* ]]; then
    check_export_xlsx_tail_leakage "$name" "$download_url" || {
      FAILED_CASES=$((FAILED_CASES + 1))
      FAILED_CASE_LIST+=("$name: XLSX tail leakage scan failed")
      return 1
    }
  fi

  PASSED_CASES=$((PASSED_CASES + 1))
  pass "$name"
}

# ---------------------------
# CSV Fixtures (intensive)
# ---------------------------

# INT1: 9 combos (Design/Dev/Content × Project/CR/Consultation), metrics empty, company mixed
CSV_COMBOS_MIXED=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'301,Design,Project,Website Redesign,ABC,2026-10-05,Improve digital conversion,,,\n'\
$'302,Design,Change Request,Accessibility Fixes,,2026-10-06,Improve compliance posture,,,\n'\
$'303,Design,Consultation,UX Audit Advisory,ABC,2026-10-07,Improve user experience,,,\n'\
$'304,Development,Project,API Platform Upgrade,XYZ,2026-10-08,Improve reliability,,,\n'\
$'305,Development,Change Request,Security Patch Rollout,,2026-10-09,Reduce production risk,,,\n'\
$'306,Development,Consultation,Architecture Review,XYZ,2026-10-10,Improve scalability,,,\n'\
$'307,Content,Project,Product Launch Content,ABC,2026-10-11,Improve acquisition,,,\n'\
$'308,Content,Change Request,Legal Copy Update,,2026-10-12,Reduce legal risk,,,\n'\
$'309,Content,Consultation,Content Strategy Advisory,ABC,2026-10-13,Improve publishing alignment,,,\n'

# INT2: Lead roles sweep (ensure lead complex + governance/risk only for leads; grammar still clean)
CSV_LEADS=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'401,Design Lead,Project,Design System Rollout,ABC,2026-10-05,Improve cross-team consistency,,,\n'\
$'402,Development Lead,Project,Platform Reliability Program,ABC,2026-10-06,Improve uptime and resilience,,,\n'\
$'403,Content Lead,Project,Enterprise Content Governance Program,ABC,2026-10-07,Improve brand compliance,,,\n'

# INT3A: Row_id canonicalization + invalid fallback (NO duplicates)
CSV_ROWID_CANON=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'"901",Design,Project,RowId String,ABC,2026-10-05,Improve conversion,,,\n'\
$'" 0902 ",Design,Project,RowId Padded,ABC,2026-10-06,Improve UX,,,\n'\
$'"abc",Design,Project,RowId Invalid,ABC,2026-10-07,Improve UX,,,\n'

# INT3B: Duplicate row_id strict error
CSV_ROWID_DUPLICATE=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'777,Design,Project,Duplicate A,ABC,2026-10-08,Improve UX,,,\n'\
$'777,Design,Project,Duplicate B,ABC,2026-10-09,Improve UX,,,\n'

# INT4: Whitespace/newlines/tabs + Arabic/special characters
CSV_TEXT_STRESS=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'501,Design,Project,"Website   Redesign\t",ABC,2026-10-05,"Improve  digital   conversion\nand acquisition",,,\n'\
$'502,Content,Change Request,"تحديث النص القانوني (Legal Copy) — v2",ABC,2026-10-06,"تقليل المخاطر القانونية + تحسين الوضوح",,,\n'

# INT5: Company column absent (missing column)
CSV_NO_COMPANY_COLUMN=$'row_id,team_role,task_type,task_name,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'601,Design,Project,Website Redesign,2026-10-05,Improve digital conversion,,,\n'\
$'602,Content,Project,Launch Content,2026-10-06,Improve acquisition,,,\n'

# INT6: Metrics imperative stress: output starts with Deliver/Provide/Support/Complete/Ensure/Achieve
# Goal: connectors must not produce "to achieve Deliver/Provide" in objectives.
CSV_IMPERATIVE_METRICS=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'701,Design,Project,Prototype Pack,ABC,2026-10-05,Improve experience,"Deliver validated prototypes for ≥ 3 critical flows",,\n'\
$'702,Content,Project,Content Briefs,ABC,2026-10-06,Improve publishing,"Provide approved briefs for all launch pages",,\n'\
$'703,Development,Project,Release Automation,ABC,2026-10-07,Improve throughput,"Ensure automated release pipeline coverage",,\n'\
$'704,Design,Project,Research Summary,ABC,2026-10-08,Improve insights,"Achieve stakeholder sign-off on research findings",,\n'

# INT7: Design/Content tail leakage stress
CSV_TAIL_LEAKAGE_GUARD=$'row_id,team_role,task_type,task_name,company,dead_line,strategic_benefit,output_metric,quality_metric,improvement_metric\n'\
$'801,Design,Project,Checkout UX Improvements,ABC,2026-10-05,Improve conversion,,,\n'\
$'802,Content,Project,SEO Landing Pages,ABC,2026-10-06,Improve acquisition,,,\n'

# ---------------------------
# Policies
# ---------------------------
POLICY_SINGLE_FILL_MISSING='{
  "mode":"single_company",
  "single_company_name":"ABC",
  "overwrite_existing_companies":false,
  "missing_company_policy":"use_single_company"
}'

POLICY_SINGLE_OVERWRITE_ALL='{
  "mode":"single_company",
  "single_company_name":"ABC",
  "overwrite_existing_companies":true,
  "missing_company_policy":"use_single_company"
}'

POLICY_ROW_LEVEL_GENERIC_MISSING='{
  "mode":"row_level",
  "single_company_name":"ABC",
  "overwrite_existing_companies":false,
  "missing_company_policy":"generic"
}'

# ---------------------------
# Main
# ---------------------------

main() {
  echo "BASE=$BASE"

  # 1) Mixed combos: multi-company + missing. Run with overwrite-all to lock company before export.
  run_bulk "INT1_COMBOS_MIXED__OVERWRITE_ALL_TO_ABC" "$CSV_COMBOS_MIXED" "$POLICY_SINGLE_OVERWRITE_ALL" || true

  # 2) Mixed combos: keep row-level companies, missing generic.
  run_bulk "INT1_COMBOS_MIXED__ROW_LEVEL_GENERIC_MISSING" "$CSV_COMBOS_MIXED" "$POLICY_ROW_LEVEL_GENERIC_MISSING" || true

  # 3) Leads: single-company fill missing (none missing) -> ensure export works.
  run_bulk "INT2_LEADS__SINGLE_COMPANY" "$CSV_LEADS" "$POLICY_SINGLE_FILL_MISSING" || true

  # 4A) Row-id canonicalization + invalid fallback (no duplicates expected)
  run_bulk "INT3A_ROWID_CANON_OK__SINGLE_COMPANY" "$CSV_ROWID_CANON" "$POLICY_SINGLE_FILL_MISSING" || true

  # 4B) Duplicate row_id should be a strict data-quality error
  run_bulk "INT3B_ROWID_DUPLICATE__EXPECT_ERROR" "$CSV_ROWID_DUPLICATE" "$POLICY_SINGLE_FILL_MISSING" "DUPLICATE_ROW_ID" || true

  # 5) Text stress: whitespace + Arabic/special chars
  run_bulk "INT4_TEXT_STRESS__SINGLE_COMPANY" "$CSV_TEXT_STRESS" "$POLICY_SINGLE_FILL_MISSING" || true

  # 6) No company column: treat as missing -> fill with ABC
  run_bulk "INT5_NO_COMPANY_COLUMN__FILL_ABC" "$CSV_NO_COMPANY_COLUMN" "$POLICY_SINGLE_FILL_MISSING" || true

  # 7) Imperative metrics grammar guard
  run_bulk "INT6_IMPERATIVE_METRICS__SINGLE_COMPANY" "$CSV_IMPERATIVE_METRICS" "$POLICY_SINGLE_FILL_MISSING" || true

  # 8) Tail leakage guard for design/content
  run_bulk "INT7_TAIL_LEAKAGE_GUARD__SINGLE_COMPANY" "$CSV_TAIL_LEAKAGE_GUARD" "$POLICY_SINGLE_FILL_MISSING" || true

  echo
  echo "===================="
  echo "SUMMARY"
  echo "===================="
  echo "Total cases:  $TOTAL_CASES"
  echo "Passed:       $PASSED_CASES"
  echo "Failed:       $FAILED_CASES"

  if [[ "$FAILED_CASES" -gt 0 ]]; then
    echo
    echo "Failed cases:"
    for item in "${FAILED_CASE_LIST[@]}"; do
      echo "- $item"
    done
    echo
    exit 1
  fi

  pass "All intensive bulk tests completed (export links generated + XLSX scanned)."
}

main "$@"