#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://kpi-gpt-backend-git-chore-depend-f257e6-nashwa-mounirs-projects.vercel.app"

echo "========================================"
echo "1) /api/kpi – transport error (no rows)"
echo "========================================"
curl -sS -X POST "$BASE_URL/api/kpi" \
  -H "Content-Type: application/json" \
  -d '{ "engine_version": "v10.7.5" }' | jq .

echo
echo "========================================"
echo "2) /api/kpi – happy path VALID row"
echo "========================================"
curl -sS -X POST "$BASE_URL/api/kpi" \
  -H "Content-Type: application/json" \
  -d '{
    "engine_version": "v10.7.5",
    "rows": [
      {
        "team_role": "Design",
        "task_type": "Project",
        "task_name": "Homepage redesign",
        "dead_line": "2025-10-01",
        "strategic_benefit": "Enhance the organization’s digital presence.",
        "output_metric": "≥90% UI deliverables approved",
        "quality_metric": "≤2% design errors",
        "improvement_metric": "Reduce design cycle time by 20%",
        "mode": "both"
      }
    ]
  }' | jq .

###############################################################################
# 3) /api/company-preflight
###############################################################################

echo
echo "========================================"
echo "3a) /api/company-preflight – analyze, named company"
echo "========================================"
curl -sS -X POST "$BASE_URL/api/company-preflight" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "analyze",
    "selected_company": "Nordic Telco AB",
    "generic_mode": false,
    "rows": [
      {
        "row_id": 1,
        "company": "Nordic Telco AB",
        "strategic_benefit": "Enhance Nordic Telco AB’s digital presence across all digital channels."
      },
      {
        "row_id": 2,
        "company": "",
        "strategic_benefit": "Improve the company’s customer experience in digital channels."
      }
    ]
  }' | jq .

echo
echo "========================================"
echo "3b) /api/company-preflight – rewrite, generic mode"
echo "========================================"
curl -sS -X POST "$BASE_URL/api/company-preflight" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "rewrite",
    "selected_company": "",
    "generic_mode": true,
    "apply_to_missing": true,
    "mismatched_strategy": "overwrite",
    "rows": [
      {
        "row_id": 1,
        "company": "Nordic Telco AB",
        "strategic_benefit": "Enhance Nordic Telco AB’s digital presence."
      },
      {
        "row_id": 2,
        "company": "",
        "strategic_benefit": ""
      }
    ]
  }' | jq .

###############################################################################
# 4) Bulk flow: /api/bulkInspectJson → /api/bulkPrepareRows → /api/bulkFinalizeExport
###############################################################################

echo
echo "========================================"
echo "4a) /api/bulkInspectJson – inspect JSON rows"
echo "========================================"

INSPECT_RESPONSE=$(
  curl -sS -X POST "$BASE_URL/api/bulkInspectJson" \
    -H "Content-Type: application/json" \
    -d '{
      "rows": [
        {
          "row_id": 1,
          "company": "Nordic Telco AB",
          "team_role": "Design Lead",
          "task_type": "Project",
          "task_name": "Design System Expansion",
          "dead_line": "15/04/2025",
          "strategic_benefit": "Strengthen Nordic Telco AB’s design consistency.",
          "output_metric": "≥90% component coverage",
          "quality_metric": "≤2% style deviations",
          "improvement_metric": "Reduce design delivery time by 30%",
          "mode": "both"
        },
        {
          "row_id": 2,
          "company": "",
          "team_role": "Content Lead",
          "task_type": "Change Request",
          "task_name": "Content Quality Enhancement",
          "dead_line": "15/04/2025",
          "strategic_benefit": "Improve the organization’s content quality.",
          "output_metric": "",
          "quality_metric": "≤3% language errors",
          "improvement_metric": "Increase engagement by 25%",
          "mode": ""
        }
      ]
    }'
)

echo "$INSPECT_RESPONSE" | jq .

ROWS_TOKEN=$(echo "$INSPECT_RESPONSE" | jq -r '.rows_token')
echo
echo "rows_token: $ROWS_TOKEN"

echo
echo "========================================"
echo "4b) /api/bulkPrepareRows – apply company strategy"
echo "========================================"

PREPARE_RESPONSE=$(
  curl -sS -X POST "$BASE_URL/api/bulkPrepareRows" \
    -H "Content-Type: application/json" \
    -d "{
      \"rows_token\": \"${ROWS_TOKEN}\",
      \"selected_company\": \"Nordic Telco AB\",
      \"generic_mode\": false,
      \"apply_to_missing\": true,
      \"mismatched_strategy\": \"keep\",
      \"invalid_handling\": \"keep\"
    }"
)

echo "$PREPARE_RESPONSE" | jq .

PREP_TOKEN=$(echo "$PREPARE_RESPONSE" | jq -r '.prep_token')
echo
echo "prep_token: $PREP_TOKEN"

echo
echo "========================================"
echo "4c) /api/bulkFinalizeExport – generate objectives + download URL"
echo "========================================"

FINALIZE_RESPONSE=$(
  curl -sS -X POST "$BASE_URL/api/bulkFinalizeExport" \
    -H "Content-Type: application/json" \
    -d "{
      \"prep_token\": \"${PREP_TOKEN}\"
    }"
)

echo "$FINALIZE_RESPONSE" | jq .

DOWNLOAD_URL=$(echo "$FINALIZE_RESPONSE" | jq -r '.download_url')
echo
echo "download_url: $DOWNLOAD_URL"

echo
echo "========================================"
echo "4d) /api/runKpiResultDownload – download KPI_Output.xlsx"
echo "========================================"

if [ "$DOWNLOAD_URL" != "null" ] && [ -n "$DOWNLOAD_URL" ]; then
  curl -sS -L "$DOWNLOAD_URL" -o KPI_Output.xlsx
  echo "Saved KPI_Output.xlsx in current directory."
else
  echo "No download_url returned (check previous response)."
fi

###############################################################################
# 5) /api/runKpiTemplateDownload – download empty KPI input template
###############################################################################

echo
echo "========================================"
echo "5) /api/runKpiTemplateDownload – download KPI_Input_Template.xlsx"
echo "========================================"

curl -sS -L "$BASE_URL/api/runKpiTemplateDownload" -o KPI_Input_Template.xlsx
echo "Saved KPI_Input_Template.xlsx in current directory."

echo
echo "========================================"
echo "DONE – all endpoints tested."
echo "========================================"