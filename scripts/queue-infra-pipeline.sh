#!/usr/bin/env bash
set -euo pipefail

for tool in jq curl; do
  if ! command -v "$tool" &>/dev/null; then
    echo "##vso[task.logissue type=error]Required tool '$tool' is not installed on this agent."
    exit 1
  fi
done

if [[ -z "${SYSTEM_ACCESSTOKEN:-}" ]]; then
  echo "##vso[task.logissue type=error]SYSTEM_ACCESSTOKEN is empty."
  echo "##vso[task.logissue type=error]Enable 'Allow scripts to access the OAuth token' in this pipeline's Settings."
  exit 1
fi

REF="${BUILD_SOURCEBRANCH}"
echo "Triggered by: $REF"

PAYLOAD=$(jq -nc --arg ref "$REF" '{"templateParameters":{"appRefOverride":$ref}}')
RESPONSE=$(curl -sS -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $SYSTEM_ACCESSTOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${SYSTEM_COLLECTIONURI}${SYSTEM_TEAMPROJECTID}/_apis/pipelines/1223/runs?api-version=7.1")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "HTTP $HTTP_CODE"

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  if echo "$BODY" | grep -q "Queue builds"; then
    echo "##vso[task.logissue type=error]PERMISSION DENIED: grant Queue builds to 'IAC Transcription Build Service (hmcts)' on pipeline 1223."
    echo "##vso[task.logissue type=error]Fix: Pipeline 1223 -> ... -> Manage security -> IAC Transcription Build Service (hmcts) -> Queue builds: Allow"
  else
    echo "##vso[task.logissue type=error]Failed to queue infra pipeline (HTTP $HTTP_CODE): $BODY"
  fi
  exit 1
fi

RUN_ID=$(echo "$BODY" | jq -r '.id // empty')
echo "Queued run $RUN_ID: ${SYSTEM_COLLECTIONURI}${SYSTEM_TEAMPROJECT}/_build/results?buildId=$RUN_ID"
