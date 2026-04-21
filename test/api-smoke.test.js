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

function assertToyShape(toy) {
  assert.equal(typeof toy.id, 'number');
  assert.equal(typeof toy.name, 'string');
  assert.equal(typeof toy.image, 'string');
  assert.equal(typeof toy.likes, 'number');
  assert.equal(typeof toy.enabled, 'boolean');
  assert.equal(typeof toy.created_at, 'string');
  assert.equal(typeof toy.updated_at, 'string');
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

test('POST /api/toys with invalid payload returns validation error', async () => {
  const response = await apiRequest('/api/toys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'A',
      image: 'not-a-uri',
    }),
  });
  const payload = await parseJson(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error?.statusCode, 422);
  assert.equal(payload.error?.message, 'Toy name must be at least 2 characters long');
});

test('Toy API CRUD + likes + export flow', async () => {
  const uniqueSuffix = Date.now();
  const createResponse = await apiRequest('/api/toys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `Robot-${uniqueSuffix}`,
      image: 'https://example.com/robot.png',
      likes: 1,
    }),
  });
  const createdToy = await parseJson(createResponse);

  assert.equal(createResponse.status, 201);
  assertToyShape(createdToy);
  assert.ok(createdToy.id >= 1);
  assert.equal(createdToy.likes, 1);
  assert.equal(createResponse.headers.get('x-ratelimit-limit') !== null, true);
  assert.equal(createResponse.headers.get('x-ratelimit-remaining') !== null, true);
  assert.equal(createResponse.headers.get('x-ratelimit-reset') !== null, true);

  const toyId = createdToy.id;

  const getToyResponse = await apiRequest(`/api/toys/${toyId}`);
  const foundToy = await parseJson(getToyResponse);
  assert.equal(getToyResponse.status, 200);
  assertToyShape(foundToy);
  assert.equal(foundToy.id, toyId);

  const likeResponse = await apiRequest(`/api/toys/${toyId}/likes`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ likes: 9 }),
  });
  const likedToy = await parseJson(likeResponse);

  assert.equal(likeResponse.status, 200);
  assert.equal(likedToy.id, toyId);
  assert.equal(likedToy.likes, 9);

  const updateResponse = await apiRequest(`/api/toys/${toyId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `Robot-${uniqueSuffix}-v2`,
      image: 'https://example.com/robot-v2.png',
    }),
  });
  const updatedToy = await parseJson(updateResponse);

  assert.equal(updateResponse.status, 200);
  assert.equal(updatedToy.id, toyId);
  assert.equal(updatedToy.name, `Robot-${uniqueSuffix}-v2`);
  assert.equal(updatedToy.image, 'https://example.com/robot-v2.png');
  assert.equal(updatedToy.likes, 9);

  const listResponse = await apiRequest('/api/toys');
  const toys = await parseJson(listResponse);

  assert.equal(listResponse.status, 200);
  assert.equal(Array.isArray(toys), true);
  assert.equal(toys.some((toy) => toy.id === toyId), true);

  const exportResponse = await apiRequest('/api/toys/export');
  const exportText = await exportResponse.text();
  const exportedToys = JSON.parse(exportText);

  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /application\/json/i);
  assert.match(
    exportResponse.headers.get('content-disposition') || '',
    /attachment; filename=export-toys-/,
  );
  assert.equal(Array.isArray(exportedToys), true);
  assert.equal(exportedToys.some((toy) => toy.id === toyId), true);

  const deleteResponse = await apiRequest(`/api/toys/${toyId}`, {
    method: 'DELETE',
  });
  const deletePayload = await parseJson(deleteResponse);

  assert.equal(deleteResponse.status, 200);
  assert.equal(deletePayload.deleted, true);

  const deletedReadResponse = await apiRequest(`/api/toys/${toyId}`);
  const deletedReadPayload = await parseJson(deletedReadResponse);

  assert.equal(deletedReadResponse.status, 404);
  assert.equal(deletedReadPayload.error?.statusCode, 404);
});
