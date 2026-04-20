#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"

echo "BASE_URL=$BASE_URL"
echo

echo "# test home"
curl -i "$BASE_URL/"
echo

echo "# test health"
curl -i "$BASE_URL/health"
echo

echo "# test docs"
curl -i "$BASE_URL/docs"
echo

echo "# test openapi"
curl -i "$BASE_URL/openapi.json"
echo

echo "# test 404 payload"
curl -i "$BASE_URL/404"
echo

echo "# test 500 payload"
curl -i "$BASE_URL/500"
echo

echo "# test favicon"
# Keep GET semantics but avoid writing binary icon bytes to terminal.
curl -sS -D - -o /dev/null "$BASE_URL/favicon.ico"
echo

echo "# test CORS preflight for /api/toys"
curl -i -X OPTIONS "$BASE_URL/api/toys" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
echo

echo "# test /api/toys status (currently expected 501)"
curl -i -X POST "$BASE_URL/api/toys" \
  -H 'content-type: application/json' \
  -d '{"name":"Robot","image":"https://example.com/robot.png","likes":0}'
echo

echo "Done."
