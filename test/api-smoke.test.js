import assert from 'node:assert/strict';
import test from 'node:test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME || '';
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';

function maybeAuthHeader() {
  if (!BASIC_AUTH_USERNAME || !BASIC_AUTH_PASSWORD) return null;

  const encoded = Buffer.from(
    `${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}`,
    'utf8',
  ).toString('base64');
  return `Basic ${encoded}`;
}

function buildHeaders(extraHeaders = {}) {
  const headers = {
    ...extraHeaders,
  };

  const authorization = maybeAuthHeader();
  if (authorization) headers.authorization = authorization;

  return headers;
}

async function apiRequest(pathname, options = {}) {
  const url = `${API_BASE_URL}${pathname}`;
  const headers = buildHeaders(options.headers || {});

  try {
    return await fetch(url, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error(
      `Cannot reach API at ${API_BASE_URL}. Start server with \"npm run dev\" before running tests. Root error: ${error.message}`,
    );
  }
}

async function parseJson(response) {
  const text = await response.text();
  assert.notEqual(text.length, 0, 'Response body must not be empty');

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON response but got: ${text}. Parse error: ${error.message}`);
  }
}

test('GET / returns welcome message', async () => {
  const response = await apiRequest('/');
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(body, 'Welcome !!!');
});

test('GET /health returns health payload and tracing headers', async () => {
  const response = await apiRequest('/health', {
    headers: {
      'x-correlation-id': 'test-correlation-id',
    },
  });
  const payload = await parseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(typeof payload.timestamp, 'string');
  assert.equal(typeof payload.uptime, 'number');
  assert.equal(response.headers.get('x-correlation-id'), 'test-correlation-id');
  assert.ok(response.headers.get('x-request-id'));
});

test('GET /openapi.json returns OpenAPI document', async () => {
  const response = await apiRequest('/openapi.json');
  const payload = await parseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.openapi, '3.1.0');
  assert.equal(payload.info?.title, 'Toy API Server - Cloudflare Worker');
});

test('GET /404 returns standardized not found payload', async () => {
  const response = await apiRequest('/404');
  const payload = await parseJson(response);

  assert.equal(response.status, 404);
  assert.equal(payload.error?.statusCode, 404);
  assert.equal(payload.error?.message, 'Route not found');
});

test('GET /500 returns standardized internal error payload', async () => {
  const response = await apiRequest('/500');
  const payload = await parseJson(response);

  assert.equal(response.status, 500);
  assert.equal(payload.error?.statusCode, 500);
  assert.equal(payload.error?.message, 'Internal Server Error');
});

test('OPTIONS preflight for /api/toys returns CORS metadata', async () => {
  const response = await apiRequest('/api/toys', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(response.headers.get('access-control-allow-headers') || '', /Content-Type/i);
});

test('POST /api/toys returns not implemented payload for current scope', async () => {
  const response = await apiRequest('/api/toys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Robot',
      image: 'https://example.com/robot.png',
      likes: 0,
    }),
  });
  const payload = await parseJson(response);

  assert.equal(response.status, 501);
  assert.equal(payload.error?.statusCode, 501);
  assert.equal(payload.error?.message, 'Toy routes are not implemented yet');
});
