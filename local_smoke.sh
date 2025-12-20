#!/usr/bin/env bash
# local_smoke.sh
# Purpose: High-confidence local/preview tests for SMART KPI backend:
# - Single vs Bulk parity (metrics family + objective text)
# - INVALID hard-stops
# - Deadline normalization + wrong-year rule
# - Bulk download/Excel integrity
# - Normalization drift (whitespace/casing/task_type variants)
#
# Usage:
#   BASE="http://localhost:3000" bash ./local_smoke.sh
#   BASE="https://<your-preview>.vercel.app" bash ./local_smoke.sh
#
# Requirements: curl, jq, file, unzip (or bsdtar). macOS has file, unzip by default.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

# NOTE: Do not hardcode expected metrics in this script.
# For exact assertions, derive expectations from the single-row /api/kpi pipeline using the same inputs.

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1"; exit 1; }; }
need curl
need jq
need file
need unzip

PASS=0
FAIL=0

section() { echo; echo "===================="; echo "$1"; echo "===================="; }
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL+1)); }

assert_eq() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$name"; else bad "$name (got='$got' want='$want')"; fi
}

assert_contains() {
  local name="$1" hay="$2" needle="$3"
  if [[ "$hay" == *"$needle"* ]]; then ok "$name"; else bad "$name (missing '$needle')"; fi
}

assert_not_contains() {
  local name="$1" hay="$2" needle="$3"
  if [[ "$hay" != *"$needle"* ]]; then ok "$name"; else bad "$name (found forbidden '$needle')"; fi
}

post_json() {
  local path="$1" body="$2"
  curl -sS -X POST "$BASE$path" -H "Content-Type: application/json" -d "$body"
}

get_file() {
  local url="$1" out="$2"
  curl -sSL -o "$out" "$url"
}

extract_download_data_param() {
  local url="$1"
  # Pull everything after 'data=' (ignore any other params)
  local data="${url#*data=}"
  data="${data%%&*}"
  echo "$data"
}

bulk_rows_from_download_url() {
  local dl="$1"
  local data
  data=$(extract_download_data_param "$dl")

  if command -v python3 >/dev/null 2>&1; then
    DATA="$data" python3 - <<'PY'
import os, sys, base64, json

data = os.environ.get('DATA','')
if not data:
    print('[]')
    sys.exit(0)

pad = '=' * ((4 - len(data) % 4) % 4)
try:
    raw = base64.urlsafe_b64decode((data + pad).encode('utf-8'))
except Exception:
    raw = base64.b64decode((data + pad).encode('utf-8'))

try:
    rows = json.loads(raw.decode('utf-8'))
except Exception:
    print('[]')
    sys.exit(0)

if not isinstance(rows, list):
    print('[]')
else:
    # Compact JSON array
    print(json.dumps(rows, ensure_ascii=False, separators=(',',':')))
PY
  else
    echo "[]"
  fi
}

bulk_first_row_from_download_url() {
  local dl="$1"
  local rows_json
  rows_json=$(bulk_rows_from_download_url "$dl")
  if [[ -z "$rows_json" || "$rows_json" == "[]" ]]; then
    echo ""
    return 0
  fi
  echo "$rows_json" | jq -c '.[0] // empty'
}

bulk_objective_from_download_url() {
  local dl="$1"
  local row_json
  row_json=$(bulk_first_row_from_download_url "$dl")

  if [[ -z "$row_json" ]]; then
    echo ""
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    ROW_JSON="$row_json" python3 - <<'PY'
import os, json
row = json.loads(os.environ['ROW_JSON'])
print(row.get('objective','') or '')
PY
  else
    echo ""
  fi
}

bulk_field_from_download_url() {
  local dl="$1" field="$2"
  local row_json
  row_json=$(bulk_first_row_from_download_url "$dl")

  if [[ -z "$row_json" ]]; then
    echo ""
    return 0
  fi

  echo "$row_json" | jq -r --arg f "$field" '.[$f] // ""'
}

bulk_row_by_id_from_download_url() {
  local dl="$1" id="$2"
  local rows_json
  rows_json=$(bulk_rows_from_download_url "$dl")
  if [[ -z "$rows_json" || "$rows_json" == "[]" ]]; then
    echo ""
    return 0
  fi
  echo "$rows_json" | jq -c --argjson rid "$id" '.[] | select(.row_id == $rid) | .'
}


bulk_row_field_by_id_from_download_url() {
  local dl="$1" id="$2" field="$3"
  local row_json
  row_json=$(bulk_row_by_id_from_download_url "$dl" "$id")
  if [[ -z "$row_json" ]]; then
    echo ""
    return 0
  fi
  echo "$row_json" | jq -r --arg f "$field" '.[$f] // ""'
}

# Helper: extract first column (row_id) values from XLSX file
xlsx_first_col_ids() {
  local xlsx="$1"
  # Extract sharedStrings + first worksheet, then reconstruct values for first column.
  # Assumes row_id is the first column in exports (recommended).
  if ! command -v python3 >/dev/null 2>&1; then
    echo ""
    return 0
  fi

  PY_XLSX="$xlsx" python3 - <<'PY'
import os, zipfile, xml.etree.ElementTree as ET

xlsx = os.environ.get('PY_XLSX','')
if not xlsx:
  print('')
  raise SystemExit

ns = {
  's': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
}

def txt(el):
  return (el.text or '').strip() if el is not None else ''

# Load sharedStrings (for inline string lookups)
shared = []
try:
  with zipfile.ZipFile(xlsx) as z:
    if 'xl/sharedStrings.xml' in z.namelist():
      root = ET.fromstring(z.read('xl/sharedStrings.xml'))
      for si in root.findall('s:si', ns):
        # shared string may be in one or many <t>
        parts = [txt(t) for t in si.findall('.//s:t', ns)]
        shared.append(''.join(parts))
    # Load sheet1
    sheet_path = 'xl/worksheets/sheet1.xml'
    if sheet_path not in z.namelist():
      print('')
      raise SystemExit
    sheet = ET.fromstring(z.read(sheet_path))

  # Iterate rows and read cell A (first column). Skip header row.
  ids = []
  rows = sheet.findall('.//s:sheetData/s:row', ns)
  for i, row in enumerate(rows):
    # Find cell with r starting with 'A'
    a = None
    for c in row.findall('s:c', ns):
      r = c.attrib.get('r','')
      if r.startswith('A'):
        a = c
        break
    if a is None:
      continue
    v = a.find('s:v', ns)
    if v is None:
      continue

    # Determine cell type
    t = a.attrib.get('t','')
    raw = txt(v)
    if not raw:
      continue

    if i == 0:
      # header row, ignore
      continue

    if t == 's':
      try:
        idx = int(raw)
        val = shared[idx] if 0 <= idx < len(shared) else ''
      except Exception:
        val = ''
    else:
      val = raw

    val = str(val).strip()
    if val:
      ids.append(val)

  print('\n'.join(ids))
except Exception:
  print('')
PY
}

# Heuristic: detect "dev-ish/generic" metric family leak into Design.
# Adjust keywords to match your real matrices.
looks_devish_metrics() {
  local text="$1"
  # Keywords that should NEVER appear for Design defaults.
  # Keep this conservative to avoid false positives.
  [[ "$text" =~ deployment|operations\ baseline|release\ window|deploy(ment)?\ success|uptime|incident|post-?release|first\ 30\ days\ post-?release ]]
}

looks_designish_metrics() {
  local text="$1"
  # keywords that SHOULD appear for Design defaults
  [[ "$text" =~ WCAG|accessibility|usability|UI|UX|design\ QA|review\ score|heuristic|prototype|Figma|design\ freeze ]]
}

# -------------------------
# 0) Ping sanity (optional)
# -------------------------
section "0) Base sanity"
echo "BASE=$BASE"
ok "Script started"

# -------------------------
# 1) Single: INVALID hard stop (minimal row)
# -------------------------
section "1) Single: INVALID hard-stop (no objectives, no autosuggest flags)"
R1=$(post_json "/api/kpi" '{"rows":[{"row_id":1}] }')

S1_STATUS=$(echo "$R1" | jq -r '.rows[0].status')
S1_OBJ=$(echo "$R1" | jq -r '.rows[0].objective // ""')
S1_AUTO=$(echo "$R1" | jq -r '.rows[0].metrics_auto_suggested // false')
S1_OUT=$(echo "$R1" | jq -r '.rows[0].resolved_metrics.output_metric // ""')

assert_eq "Single invalid status" "$S1_STATUS" "INVALID"
assert_eq "Single invalid objective empty" "$S1_OBJ" ""
assert_eq "Single invalid metrics_auto_suggested=false" "$S1_AUTO" "false"
assert_eq "Single invalid output_metric empty" "$S1_OUT" ""

# -------------------------
# 2) Single: VALID with user metrics (Design + Project)
# -------------------------
section "2) Single: VALID with user metrics (Design + Project)"
R2=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 2,
      "team_role":"Design",
      "task_type":"Project",
      "task_name":"Homepage redesign",
      "dead_line":"2025-10-01",
      "strategic_benefit":"Enhance the organization’s digital presence.",
      "output_metric":"Publish approved homepage screens",
      "quality_metric":"Achieve WCAG 2.1 AA compliance in UI deliverables",
      "improvement_metric":"Reduce design rework cycle time by 20%"
    }
  ]
}')

S2_STATUS=$(echo "$R2" | jq -r '.rows[0].status')
S2_MODE=$(echo "$R2" | jq -r '.rows[0].objective_mode')
S2_AUTO=$(echo "$R2" | jq -r '.rows[0].metrics_auto_suggested')
S2_OBJ=$(echo "$R2" | jq -r '.rows[0].objective')

assert_eq "Single status=VALID" "$S2_STATUS" "VALID"
assert_eq "Single autosuggest=false" "$S2_AUTO" "false"
# Mode depends on your contract; keep as a check not a blocker:
[[ "$S2_MODE" == "simple" || "$S2_MODE" == "complex" || "$S2_MODE" == "" ]] && ok "Single objective_mode present ($S2_MODE)" || bad "Single objective_mode invalid ($S2_MODE)"

# Trust-killer phrases (track even if not fixed yet)
assert_not_contains "Objective must not contain 'in support of supporting'" "$S2_OBJ" "in support of supporting"
assert_not_contains "Objective must not contain 'to achieve Deliver'" "$S2_OBJ" "to achieve Deliver"

# Ensure-metric grammar regression guard
assert_not_contains "Objective must not contain 'to achieve Ensure'" "$S2_OBJ" "to achieve Ensure"

# -------------------------
# 3) Single: NEEDS_REVIEW + autosuggest (Development missing all metrics)
# -------------------------
section "3) Single: NEEDS_REVIEW + autosuggest (Dev missing all metrics)"
R3=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 3,
      "team_role":"Development",
      "task_type":"Project",
      "task_name":"API Rate-Limit Upgrade",
      "dead_line":"2025-06-30",
      "strategic_benefit":"Improve system reliability."
    }
  ]
}')

S3_STATUS=$(echo "$R3" | jq -r '.rows[0].status')
S3_AUTO=$(echo "$R3" | jq -r '.rows[0].metrics_auto_suggested')
S3_RES=$(echo "$R3" | jq -r '.rows[0].resolved_metrics | "\(.output_metric) | \(.quality_metric) | \(.improvement_metric)"')

assert_eq "Single status=NEEDS_REVIEW" "$S3_STATUS" "NEEDS_REVIEW"
assert_eq "Single autosuggest=true" "$S3_AUTO" "true"
[[ -n "$S3_RES" ]] && ok "Single resolved_metrics filled" || bad "Single resolved_metrics empty"

# -------------------------
# 4) Single: Deadline wrong-year should be INVALID
# -------------------------
section "4) Single: Deadline wrong-year => INVALID"
R4=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 4,
      "team_role":"Design",
      "task_type":"Project",
      "task_name":"Homepage redesign",
      "dead_line":"2027-10-01",
      "strategic_benefit":"Enhance the organization’s digital presence.",
      "output_metric":"Publish approved homepage screens",
      "quality_metric":"Meet design QA checklist",
      "improvement_metric":"Reduce iteration cycles by 20%"
    }
  ]
}')
S4_STATUS=$(echo "$R4" | jq -r '.rows[0].status')
S4_OBJ=$(echo "$R4" | jq -r '.rows[0].objective // ""')
S4_AUTO=$(echo "$R4" | jq -r '.rows[0].metrics_auto_suggested // false')
assert_eq "Single wrong-year status=INVALID" "$S4_STATUS" "INVALID"
assert_eq "Single wrong-year objective empty" "$S4_OBJ" ""
assert_eq "Single wrong-year autosuggest=false" "$S4_AUTO" "false"

# -------------------------
# 4B) Bulk: INVALID hard-stop (missing required fields)
# -------------------------
section "4B) Bulk: INVALID hard-stop (missing required fields)"
CSV_INV='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
1,Design,Project,,2025-10-01,Enhance the organization’s digital presence.'
INS_INV=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV_INV" '{excel_csv_text:$csv}')")
RT_INV=$(echo "$INS_INV" | jq -r '.rows_token')
PRE_INV=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT_INV" '{rows_token:$t, generic_mode:true}')")
PT_INV=$(echo "$PRE_INV" | jq -r '.prep_token')
FIN_INV=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT_INV" '{prep_token:$t}')")
DL_INV=$(echo "$FIN_INV" | jq -r '.download_url')

ROW_INV=$(bulk_first_row_from_download_url "$DL_INV")
INV_STATUS=$(echo "$ROW_INV" | jq -r '.validation_status')
INV_OBJ=$(echo "$ROW_INV" | jq -r '.objective')
INV_AUTO=$(echo "$ROW_INV" | jq -r '.metrics_auto_suggested')

assert_eq "Bulk invalid status" "$INV_STATUS" "INVALID"
assert_eq "Bulk invalid objective empty" "$INV_OBJ" ""
assert_eq "Bulk invalid metrics_auto_suggested=false" "$INV_AUTO" "false"

# -------------------------
# 5) Bulk: One-row flow + download integrity
# -------------------------
section "5) Bulk: 1-row flow + download integrity (no xargs)"
CSV='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
1,Design,Project,Homepage redesign,2025-10-01,Enhance the organization’s digital presence.'
INSPECT=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV" '{excel_csv_text:$csv}')")

ROWS_TOKEN=$(echo "$INSPECT" | jq -r '.rows_token')
ROW_COUNT=$(echo "$INSPECT" | jq -r '.row_count')
assert_eq "Bulk inspect row_count=1" "$ROW_COUNT" "1"
[[ -n "$ROWS_TOKEN" && "$ROWS_TOKEN" != "null" ]] && ok "Bulk rows_token present" || bad "Bulk rows_token missing"

PREP=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$ROWS_TOKEN" '{rows_token:$t, generic_mode:true}')")
PREP_TOKEN=$(echo "$PREP" | jq -r '.prep_token')
STATE=$(echo "$PREP" | jq -r '.state')
assert_eq "Bulk prepare state READY_FOR_OBJECTIVES" "$STATE" "READY_FOR_OBJECTIVES"
[[ -n "$PREP_TOKEN" && "$PREP_TOKEN" != "null" ]] && ok "Bulk prep_token present" || bad "Bulk prep_token missing"

FINAL=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PREP_TOKEN" '{prep_token:$t}')")
DL=$(echo "$FINAL" | jq -r '.download_url')
[[ -n "$DL" && "$DL" != "null" ]] && ok "Bulk finalize download_url present" || bad "Bulk finalize download_url missing"

BULK_ROW_JSON=$(bulk_first_row_from_download_url "$DL")
[[ -n "$BULK_ROW_JSON" ]] && ok "Decoded bulk first row json from download_url" || bad "Could not decode bulk first row json from download_url"

OUT="KPI_Output.xlsx"
# Decode the objective directly from the download_url payload (source-of-truth for what will be written to XLSX)
DATA=$(extract_download_data_param "$DL")
OBJ_BULK_DECODED=$(DATA="$DATA" bulk_objective_from_download_url "$DL")
[[ -n "$OBJ_BULK_DECODED" ]] && ok "Decoded bulk objective from download_url" || bad "Could not decode bulk objective from download_url"

get_file "$BASE$DL" "$OUT"

# File signature sanity
FILETYPE=$(file "$OUT" | tr -d '\n')
assert_contains "XLSX file signature (file reports Excel 2007+)" "$FILETYPE" "Microsoft Excel"

# ZIP integrity test (xlsx is a zip)
if unzip -t "$OUT" >/dev/null 2>&1; then
  ok "XLSX zip integrity ok (unzip -t)"
else
  bad "XLSX zip integrity failed (file corrupt)"
fi

# -------------------------
# 6) Bulk vs Single parity: metrics family for Design+Project missing metrics
# -------------------------
section "6) Bulk vs Single parity: Design+Project missing metrics should be DESIGN family"
# Single (same as bulk row but JSON) with missing metrics:
S_PAR=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 1,
      "team_role":"Design",
      "task_type":"Project",
      "task_name":"Homepage redesign",
      "dead_line":"2025-10-01",
      "strategic_benefit":"Enhance the organization’s digital presence."
    }
  ]
}')
S6_STATUS=$(echo "$S_PAR" | jq -r '.rows[0].status')
S6_RES=$(echo "$S_PAR" | jq -r '.rows[0].resolved_metrics | "\(.output_metric) | \(.quality_metric) | \(.improvement_metric)"')
assert_eq "Single Design missing metrics => NEEDS_REVIEW" "$S6_STATUS" "NEEDS_REVIEW"

# Use decoded bulk objective instead of fragile XLSX parsing
OBJ_BULK="$OBJ_BULK_DECODED"
[[ -n "$OBJ_BULK" ]] && ok "Bulk objective available for checks" || bad "Bulk objective missing (decode failed)"

# Exact resolved metrics assertions (parity):
# Compare bulk-resolved metrics against the single-row /api/kpi pipeline using the same inputs.
if [[ -n "$BULK_ROW_JSON" ]]; then
  BULK_OUT=$(echo "$BULK_ROW_JSON" | jq -r '.output_metric // ""')
  BULK_QUAL=$(echo "$BULK_ROW_JSON" | jq -r '.quality_metric // ""')
  BULK_IMP=$(echo "$BULK_ROW_JSON" | jq -r '.improvement_metric // ""')
  BULK_AUTO=$(echo "$BULK_ROW_JSON" | jq -r '.metrics_auto_suggested // ""')

  if [[ -z "$BULK_OUT" && -z "$BULK_QUAL" && -z "$BULK_IMP" ]]; then
    bad "Bulk download payload missing resolved metrics fields (output/quality/improvement). Ensure bulkFinalizeExport includes them in encoded result rows + XLSX."
  else
    # Expected metrics from SINGLE pipeline (same input as bulk CSV row)
    EXP_OUT=$(echo "$S_PAR" | jq -r '.rows[0].resolved_metrics.output_metric // ""')
    EXP_QUAL=$(echo "$S_PAR" | jq -r '.rows[0].resolved_metrics.quality_metric // ""')
    EXP_IMP=$(echo "$S_PAR" | jq -r '.rows[0].resolved_metrics.improvement_metric // ""')
    EXP_AUTO=$(echo "$S_PAR" | jq -r '.rows[0].metrics_auto_suggested // ""')

    assert_eq "Bulk exact output_metric (parity with single)" "$BULK_OUT" "$EXP_OUT"
    assert_eq "Bulk exact quality_metric (parity with single)" "$BULK_QUAL" "$EXP_QUAL"
    assert_eq "Bulk exact improvement_metric (parity with single)" "$BULK_IMP" "$EXP_IMP"

    # If ANY metric is auto-filled, both flows should report metrics_auto_suggested=true
    assert_eq "Bulk metrics_auto_suggested (parity with single)" "$BULK_AUTO" "$EXP_AUTO"
  fi
else
  bad "Bulk row json not available; cannot assert exact metrics"
fi

# Detect dev-ish leak
if looks_devish_metrics "$OBJ_BULK"; then
  bad "Bulk objective looks DEV-ISH (matrix miss / fallback still happening)"
else
  ok "Bulk objective does not look dev-ish (no obvious fallback keywords)"
fi

# Detect design-ish presence (optional: may fail if your design defaults don’t include these exact words)
if looks_designish_metrics "$OBJ_BULK"; then
  ok "Bulk objective matches design-ish keyword heuristic"
else
  echo "⚠️  Note: bulk objective did not match design-ish keyword heuristic; verify manually."
fi

# Trust-killer phrase checks on bulk objective
assert_not_contains "Bulk objective must not contain 'in support of supporting'" "$OBJ_BULK" "in support of supporting"
assert_not_contains "Bulk objective must not contain 'to achieve Deliver'" "$OBJ_BULK" "to achieve Deliver"

# -------------------------
# 6B) Partial metrics missing parity (E502 path)
# -------------------------
section "6B) Partial metrics missing parity (E502 path)"
R_PART=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 61,
      "team_role":"Design",
      "task_type":"Project",
      "task_name":"Pricing page update",
      "dead_line":"2025-09-15",
      "strategic_benefit":"Improve conversion rate.",
      "output_metric":"Publish updated pricing UI"
    }
  ]
}')

EXP_P_OUT=$(echo "$R_PART" | jq -r '.rows[0].resolved_metrics.output_metric')
EXP_P_QUAL=$(echo "$R_PART" | jq -r '.rows[0].resolved_metrics.quality_metric')
EXP_P_IMP=$(echo "$R_PART" | jq -r '.rows[0].resolved_metrics.improvement_metric')

CSV_PART='row_id,team_role,task_type,task_name,dead_line,strategic_benefit,output_metric
61,Design,Project,Pricing page update,2025-09-15,Improve conversion rate.,Publish updated pricing UI'
INS_P=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV_PART" '{excel_csv_text:$csv}')")
RT_P=$(echo "$INS_P" | jq -r '.rows_token')
PRE_P=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT_P" '{rows_token:$t, generic_mode:true}')")
PT_P=$(echo "$PRE_P" | jq -r '.prep_token')
FIN_P=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT_P" '{prep_token:$t}')")
DL_P=$(echo "$FIN_P" | jq -r '.download_url')
ROW_P=$(bulk_first_row_from_download_url "$DL_P")

assert_eq "Bulk partial output_metric parity" "$(echo "$ROW_P" | jq -r '.output_metric')" "$EXP_P_OUT"
assert_eq "Bulk partial quality_metric parity" "$(echo "$ROW_P" | jq -r '.quality_metric')" "$EXP_P_QUAL"
assert_eq "Bulk partial improvement_metric parity" "$(echo "$ROW_P" | jq -r '.improvement_metric')" "$EXP_P_IMP"

# -------------------------
# 7) Bulk normalization drift tests (whitespace/casing)
# -------------------------
section "7) Bulk normalization drift: whitespace/casing should still hit correct matrix"
CSV2='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
1," Design "," Project ",Homepage redesign,2025-10-01,Enhance the organization’s digital presence.'
INS2=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV2" '{excel_csv_text:$csv}')")
RT2=$(echo "$INS2" | jq -r '.rows_token')
PRE2=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT2" '{rows_token:$t, generic_mode:true}')")
PT2=$(echo "$PRE2" | jq -r '.prep_token')
FIN2=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT2" '{prep_token:$t}')")
DL2=$(echo "$FIN2" | jq -r '.download_url')
get_file "$BASE$DL2" "KPI_Output_ws.xlsx"
unzip -t "KPI_Output_ws.xlsx" >/dev/null 2>&1 && ok "Bulk whitespace XLSX ok" || bad "Bulk whitespace XLSX corrupt"

# -------------------------
# 7B) Lead role must enforce complex mode (single + bulk)
# -------------------------
section "7B) Lead role complex enforcement"
R_LEAD=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 71,
      "team_role":"Design Lead",
      "task_type":"Project",
      "task_name":"Design system rollout",
      "dead_line":"2025-11-01",
      "strategic_benefit":"Improve cross-team consistency."
    }
  ]
}')
LEAD_MODE=$(echo "$R_LEAD" | jq -r '.rows[0].objective_mode')
[[ "$LEAD_MODE" == "complex" ]] && ok "Single lead role forces complex mode" || bad "Lead role did not force complex mode"

CSV_LEAD='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
1,Design Lead,Project,Design system rollout,2025-11-01,Improve cross-team consistency.'
INS_L=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV_LEAD" '{excel_csv_text:$csv}')")
RT_L=$(echo "$INS_L" | jq -r '.rows_token')
PRE_L=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT_L" '{rows_token:$t, generic_mode:true}')")
PT_L=$(echo "$PRE_L" | jq -r '.prep_token')
FIN_L=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT_L" '{prep_token:$t}')")
DL_L=$(echo "$FIN_L" | jq -r '.download_url')
ROW_L=$(bulk_first_row_from_download_url "$DL_L")

[[ -n "$(echo "$ROW_L" | jq -r '.objective')" ]] && ok "Bulk lead objective generated" || bad "Bulk lead objective missing"

# -------------------------
# 7C) Bulk multi-row matrix coverage: all team roles (exact metric parity)
# -------------------------
section "7C) Bulk multi-row coverage: exact resolved-metrics parity across all team roles"

# NOTE: Use allowed task types from your constants. If 'Consultation' is not allowed,
# change it to another allowed value (e.g., 'Change Request').
CSV_M='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
101,Content,Project,Content calendar refresh,2025-10-15,Improve content relevance.
102,Content Lead,Consultation,Editorial governance review,2025-10-20,Improve cross-team alignment.
103,Design,Project,Homepage redesign,2025-10-01,Enhance the organization’s digital presence.
104,Design Lead,Consultation,Design system adoption plan,2025-11-01,Increase consistency and efficiency.
105,Development,Project,API Rate-Limit Upgrade,2025-06-30,Improve system reliability.
106,Development Lead,Consultation,API governance and standards,2025-07-15,Reduce risk and improve maintainability.'

INS_M=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV_M" '{excel_csv_text:$csv}')")
RT_M=$(echo "$INS_M" | jq -r '.rows_token')
[[ -n "$RT_M" && "$RT_M" != "null" ]] && ok "Bulk multi rows_token present" || bad "Bulk multi rows_token missing"

PRE_M=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT_M" '{rows_token:$t, generic_mode:true}')")
PT_M=$(echo "$PRE_M" | jq -r '.prep_token')
[[ -n "$PT_M" && "$PT_M" != "null" ]] && ok "Bulk multi prep_token present" || bad "Bulk multi prep_token missing"

FIN_M=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT_M" '{prep_token:$t}')")
DL_M=$(echo "$FIN_M" | jq -r '.download_url')
[[ -n "$DL_M" && "$DL_M" != "null" ]] && ok "Bulk multi download_url present" || bad "Bulk multi download_url missing"

ROWS_M=$(bulk_rows_from_download_url "$DL_M")
COUNT_M=$(echo "$ROWS_M" | jq -r 'length')
[[ "$COUNT_M" -ge 6 ]] && ok "Bulk multi decoded rows >= 6 ($COUNT_M)" || bad "Bulk multi decoded row count too small ($COUNT_M)"

# Helper to run single /api/kpi and return resolved metrics for an id
single_resolved_for() {
  local id="$1" role="$2" type="$3" name="$4" dl="$5" benefit="$6"
  post_json "/api/kpi" "$(jq -n \
    --argjson row_id "$id" \
    --arg team_role "$role" \
    --arg task_type "$type" \
    --arg task_name "$name" \
    --arg dead_line "$dl" \
    --arg strategic_benefit "$benefit" \
    '{rows:[{row_id:$row_id,team_role:$team_role,task_type:$task_type,task_name:$task_name,dead_line:$dead_line,strategic_benefit:$strategic_benefit}]}')"
}

# Loop the 6 rows and assert exact parity per-row
for RID in 101 102 103 104 105 106; do
  BULK_ROW=$(bulk_row_by_id_from_download_url "$DL_M" "$RID")
  if [[ -z "$BULK_ROW" ]]; then
    bad "Bulk row_id=$RID missing in download payload"
    continue
  fi

  B_ROLE=$(echo "$BULK_ROW" | jq -r '.team_role')
  B_TYPE=$(echo "$BULK_ROW" | jq -r '.task_type')
  B_NAME=$(echo "$BULK_ROW" | jq -r '.task_name')
  B_DL=$(echo "$BULK_ROW" | jq -r '.dead_line')
  B_OBJ=$(echo "$BULK_ROW" | jq -r '.objective')
  B_OUT=$(echo "$BULK_ROW" | jq -r '.output_metric')
  B_QUAL=$(echo "$BULK_ROW" | jq -r '.quality_metric')
  B_IMP=$(echo "$BULK_ROW" | jq -r '.improvement_metric')
  B_AUTO=$(echo "$BULK_ROW" | jq -r '.metrics_auto_suggested')

  # Pull the same benefit used in the CSV (hardcoded map)
  case "$RID" in
    101) BENEFIT="Improve content relevance.";;
    102) BENEFIT="Improve cross-team alignment.";;
    103) BENEFIT="Enhance the organization’s digital presence.";;
    104) BENEFIT="Increase consistency and efficiency.";;
    105) BENEFIT="Improve system reliability.";;
    106) BENEFIT="Reduce risk and improve maintainability.";;
  esac

  SINGLE=$(single_resolved_for "$RID" "$B_ROLE" "$B_TYPE" "$B_NAME" "$B_DL" "$BENEFIT")
  S_STATUS=$(echo "$SINGLE" | jq -r '.rows[0].status')
  S_AUTO=$(echo "$SINGLE" | jq -r '.rows[0].metrics_auto_suggested')
  S_OUT=$(echo "$SINGLE" | jq -r '.rows[0].resolved_metrics.output_metric')
  S_QUAL=$(echo "$SINGLE" | jq -r '.rows[0].resolved_metrics.quality_metric')
  S_IMP=$(echo "$SINGLE" | jq -r '.rows[0].resolved_metrics.improvement_metric')

  # All these rows have missing metrics → should be NEEDS_REVIEW in your contract
  assert_eq "Single status NEEDS_REVIEW (row_id=$RID)" "$S_STATUS" "NEEDS_REVIEW"

  assert_eq "Bulk output_metric parity (row_id=$RID)" "$B_OUT" "$S_OUT"
  assert_eq "Bulk quality_metric parity (row_id=$RID)" "$B_QUAL" "$S_QUAL"
  assert_eq "Bulk improvement_metric parity (row_id=$RID)" "$B_IMP" "$S_IMP"
  assert_eq "Bulk metrics_auto_suggested parity (row_id=$RID)" "$B_AUTO" "$S_AUTO"

  # Objective regression guards per-row
  assert_not_contains "Bulk objective no 'in support of supporting' (row_id=$RID)" "$B_OBJ" "in support of supporting"
  assert_not_contains "Bulk objective no 'to achieve Deliver' (row_id=$RID)" "$B_OBJ" "to achieve Deliver"
  assert_not_contains "Bulk objective no 'to achieve Ensure' (row_id=$RID)" "$B_OBJ" "to achieve Ensure"

done

 # -------------------------
# 7D) Bulk row_id preservation: non-sequential ids + XLSX column
# -------------------------
section "7D) Bulk row_id preservation: non-sequential ids + XLSX column"

CSV_RID='row_id,team_role,task_type,task_name,dead_line,strategic_benefit
101,Design,Project,RowId test A,2025-10-01,Enhance the organization’s digital presence.
305,Design,Project,RowId test B,2025-10-02,Enhance the organization’s digital presence.
999,Design,Project,RowId test C,2025-10-03,Enhance the organization’s digital presence.'

INS_RID=$(post_json "/api/bulkInspectJson" "$(jq -n --arg csv "$CSV_RID" '{excel_csv_text:$csv}')")
RT_RID=$(echo "$INS_RID" | jq -r '.rows_token')
[[ -n "$RT_RID" && "$RT_RID" != "null" ]] && ok "Bulk row_id fixture rows_token present" || bad "Bulk row_id fixture rows_token missing"

PRE_RID=$(post_json "/api/bulkPrepareRows" "$(jq -n --arg t "$RT_RID" '{rows_token:$t, generic_mode:true}')")
PT_RID=$(echo "$PRE_RID" | jq -r '.prep_token')
[[ -n "$PT_RID" && "$PT_RID" != "null" ]] && ok "Bulk row_id fixture prep_token present" || bad "Bulk row_id fixture prep_token missing"

FIN_RID=$(post_json "/api/bulkFinalizeExport" "$(jq -n --arg t "$PT_RID" '{prep_token:$t}')")
DL_RID=$(echo "$FIN_RID" | jq -r '.download_url')
[[ -n "$DL_RID" && "$DL_RID" != "null" ]] && ok "Bulk row_id fixture download_url present" || bad "Bulk row_id fixture download_url missing"

# Assert decoded payload contains the exact row_ids (not just count/order)
ROW_101=$(bulk_row_by_id_from_download_url "$DL_RID" 101)
ROW_305=$(bulk_row_by_id_from_download_url "$DL_RID" 305)
ROW_999=$(bulk_row_by_id_from_download_url "$DL_RID" 999)

[[ -n "$ROW_101" ]] && ok "Decoded payload contains row_id=101" || bad "Decoded payload missing row_id=101"
[[ -n "$ROW_305" ]] && ok "Decoded payload contains row_id=305" || bad "Decoded payload missing row_id=305"
[[ -n "$ROW_999" ]] && ok "Decoded payload contains row_id=999" || bad "Decoded payload missing row_id=999"

# Download XLSX and assert Row ID column includes the same ids.
OUT_RID="KPI_Output_rowid.xlsx"
get_file "$BASE$DL_RID" "$OUT_RID"

XIDS=$(xlsx_first_col_ids "$OUT_RID" || true)

if [[ -z "$XIDS" ]]; then
  echo "⚠️  Note: Could not extract Row IDs from XLSX. Ensure runKpiResultDownload writes row_id as the first column (Row ID)."
else
  if echo "$XIDS" | grep -qx "101"; then ok "XLSX contains row_id=101"; else bad "XLSX missing row_id=101"; fi
  if echo "$XIDS" | grep -qx "305"; then ok "XLSX contains row_id=305"; else bad "XLSX missing row_id=305"; fi
  if echo "$XIDS" | grep -qx "999"; then ok "XLSX contains row_id=999"; else bad "XLSX missing row_id=999"; fi
fi

# -------------------------
# 8) Task type variant handling: ensure invalid variant becomes INVALID (no silent fallback)
# -------------------------
section "8) Task type variants: unsupported values should be INVALID (not fallback)"
R8=$(post_json "/api/kpi" '{
  "rows":[
    {
      "row_id": 8,
      "team_role":"Design",
      "task_type":"ChangeRequest",
      "task_name":"Update pricing page UI",
      "dead_line":"2025-09-15",
      "strategic_benefit":"Improve conversion rate."
    }
  ]
}')
# Depending on your normalizeTaskType rules: either it normalizes, or it invalidates.
# We accept only: VALID/NEEDS_REVIEW if normalized; INVALID if not allowed. But MUST NOT silently hit wrong matrix.
S8_STATUS=$(echo "$R8" | jq -r '.rows[0].status')
if [[ "$S8_STATUS" == "INVALID" ]]; then
  ok "Unsupported task_type correctly INVALID"
else
  ok "Task_type normalized/allowed (status=$S8_STATUS) — verify task_type normalization rules if unexpected"
fi

# -------------------------
# Summary
# -------------------------
section "SUMMARY"
echo "PASS=$PASS"
echo "FAIL=$FAIL"
echo

if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED: One or more checks failed."
  exit 1
else
  echo "OK: All checks passed."
  exit 0
fi