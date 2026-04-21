import { statusCodes } from '../lib/variables.js';

async function serveAsset(pathname, request, env, response) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return response.error(statusCodes.NOT_FOUND, 'Asset not found');
  }

  const assetRequest = new Request(new URL(pathname, request.url), request);
  const assetResponse = await env.ASSETS.fetch(assetRequest);
  if (!assetResponse.ok) {
    return response.error(statusCodes.NOT_FOUND, 'Asset not found');
  }

  return response.binary(assetResponse.body, assetResponse.status, assetResponse.headers);
}

function buildOpenApiSpec(basicAuthEnabled) {
  const toySchema = {
    type: 'object',
    required: ['id', 'name', 'image', 'likes', 'enabled', 'created_at', 'updated_at'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      image: { type: 'string' },
      likes: { type: 'integer' },
      enabled: { type: 'boolean' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Toy API Server - Cloudflare Worker',
      version: '1.0.0',
      description:
        'Cloudflare Worker implementation backed by KV with TTL-based toy lifecycle and anti-abuse limits.',
    },
    components: {
      securitySchemes: basicAuthEnabled
        ? {
            basicAuth: {
              type: 'http',
              scheme: 'basic',
            },
          }
        : undefined,
      schemas: {
        Toy: toySchema,
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                statusCode: { type: 'integer' },
                message: { type: 'string' },
                details: {},
              },
            },
          },
        },
      },
    },
    paths: {
      '/': { get: { summary: 'Show welcome message' } },
      '/health': { get: { summary: 'Check health' } },
      '/api/toys': {
        get: { summary: 'List toys' },
        post: { summary: 'Create toy' },
      },
      '/api/toys/{id}': {
        get: { summary: 'Get toy by id' },
        delete: { summary: 'Delete toy by id' },
        post: { summary: 'Update toy by id' },
        put: { summary: 'Update toy by id' },
        patch: { summary: 'Update toy by id' },
      },
      '/api/toys/{id}/likes': {
        post: { summary: 'Update likes' },
        put: { summary: 'Update likes' },
        patch: { summary: 'Update likes' },
      },
    },
    security: basicAuthEnabled ? [{ basicAuth: [] }] : [],
  };
}

export async function handleHomeRoutes({
  basicAuthEnabled,
  env,
  isAssetReadMethod,
  pathname,
  request,
  response,
  workerStartedAt,
}) {
  if (pathname === '/' && request.method === 'GET') {
    return response.text('Welcome !!!');
  }

  if (pathname === '/health' && request.method === 'GET') {
    return response.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - workerStartedAt) / 1000,
    });
  }

  if (pathname === '/favicon.ico' && isAssetReadMethod) {
    return serveAsset('/public/favicon.ico', request, env, response);
  }

  if (pathname === '/favicon.png' && isAssetReadMethod) {
    return serveAsset('/public/favicon.png', request, env, response);
  }

  if (pathname === '/docs' && isAssetReadMethod) {
    return serveAsset('/public/docs.html', request, env, response);
  }

  if (pathname.startsWith('/public/') && isAssetReadMethod) {
    return serveAsset(pathname, request, env, response);
  }

  if (pathname === '/openapi.json' && request.method === 'GET') {
    const spec = buildOpenApiSpec(basicAuthEnabled);
    return response.json(spec);
  }

  return null;
}
