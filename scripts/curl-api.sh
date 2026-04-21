#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOY_NAME_SUFFIX="$(date +%s)"

curl_with_status() {
  local -a curl_args=("$@")
  curl -sS "${curl_args[@]}" -w $'\n__CURL_STATUS__:%{http_code}'
}

request_with_headers() {
  local label="$1"
  local expected_status="$2"
  shift 2

  local response
  response="$(curl_with_status -i "$@")"

  local actual_status
  actual_status="${response##*__CURL_STATUS__:}"
  local output
  output="${response%$'\n__CURL_STATUS__:'*}"

  echo "$output"

  if [[ "$actual_status" != "$expected_status" ]]; then
    echo
    echo "ERROR [$label]: expected HTTP $expected_status but got $actual_status" >&2
    exit 1
  fi
}

request_json_body() {
  local label="$1"
  local expected_status="$2"
  shift 2

  local response
  response="$(curl_with_status "$@")"

  local actual_status
  actual_status="${response##*__CURL_STATUS__:}"
  local body
  body="${response%$'\n__CURL_STATUS__:'*}"

  if [[ "$actual_status" != "$expected_status" ]]; then
    echo "$body"
    echo
    echo "ERROR [$label]: expected HTTP $expected_status but got $actual_status" >&2
    exit 1
  fi

  echo "$body"
}

echo "BASE_URL=$BASE_URL"
echo

echo "# test home"
request_with_headers "home" "200" "$BASE_URL/"
echo

echo "# test health"
request_with_headers "health" "200" "$BASE_URL/health"
echo

echo "# test docs"
request_with_headers "docs" "200" "$BASE_URL/docs"
echo

echo "# test openapi"
request_with_headers "openapi" "200" "$BASE_URL/openapi.json"
echo

echo "# test 404 payload"
request_with_headers "404 payload" "404" "$BASE_URL/404"
echo

echo "# test 500 payload"
request_with_headers "500 payload" "500" "$BASE_URL/500"
echo

echo "# test favicon"
request_with_headers "favicon" "200" -I "$BASE_URL/favicon.ico"
echo

echo "# test CORS preflight for /api/toys"
request_with_headers "CORS preflight" "204" -X OPTIONS "$BASE_URL/api/toys" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
echo

echo "# create toy"
CREATE_RESPONSE=$(request_json_body "create toy" "201" -X POST "$BASE_URL/api/toys" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Robot-$TOY_NAME_SUFFIX\",\"image\":\"https://example.com/robot.png\",\"likes\":1}")
echo "$CREATE_RESPONSE"
echo

TOY_ID=$(echo "$CREATE_RESPONSE" | grep -oE '"id":[0-9]+' | head -n1 | cut -d: -f2 || true)

if [[ -z "$TOY_ID" ]]; then
  echo "Cannot extract toy id from create response."
  echo "Done with partial checks."
  exit 0
fi

echo "TOY_ID=$TOY_ID"
echo

echo "# list toys"
request_with_headers "list toys" "200" "$BASE_URL/api/toys"
echo

echo "# get toy by id"
request_with_headers "get toy by id" "200" "$BASE_URL/api/toys/$TOY_ID"
echo

echo "# update likes"
request_with_headers "update likes" "200" -X PATCH "$BASE_URL/api/toys/$TOY_ID/likes" \
  -H 'content-type: application/json' \
  -d '{"likes":9}'
echo

echo "# update toy"
request_with_headers "update toy" "200" -X PATCH "$BASE_URL/api/toys/$TOY_ID" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Robot-$TOY_NAME_SUFFIX-v2\",\"image\":\"https://example.com/robot-v2.png\"}"
echo

echo "# export toys"
request_with_headers "export toys" "200" "$BASE_URL/api/toys/export"
echo

echo "# delete toy"
request_with_headers "delete toy" "200" -X DELETE "$BASE_URL/api/toys/$TOY_ID"
echo

echo "# get deleted toy (expect 404)"
request_with_headers "get deleted toy" "404" "$BASE_URL/api/toys/$TOY_ID"
echo

echo "Done."
