import { parseBoolean, statusCodes } from './lib/constants.js';
import { checkBasicAuth, resolveBasicAuthOptions } from './lib/auth.js';
import { normalizePath } from './lib/client.js';
import {
  buildCorsFailurePayload,
  corsAllowedHeaders,
  corsExposedHeaders,
  corsMethods,
  isCorsOriginAllowed,
  parseCorsOrigins,
} from './lib/cors.js';
import { errorPayload } from './lib/http.js';

const workerStartedAt = Date.now();

function resolveSecurityHeadersOptions(env = {}, nodeEnv = 'development') {
  const enabled =
    typeof env.SECURITY_HEADERS_ENABLED !== 'undefined'
      ? parseBoolean(env.SECURITY_HEADERS_ENABLED, true)
      : nodeEnv !== 'test';

  return {
    enabled,
  };
}

function createResponseHelpers(context) {
  function applyCommonHeaders(headers) {
    headers.set('x-correlation-id', context.correlationId);
    headers.set('x-request-id', context.requestId);

    if (context.cors.origin) {
      headers.set('access-control-allow-origin', context.cors.origin);
      headers.set('access-control-expose-headers', corsExposedHeaders.join(', '));
      headers.set('vary', 'Origin');
    }

    if (context.securityHeaders.enabled) {
      headers.set('x-content-type-options', 'nosniff');
      headers.set('x-frame-options', 'SAMEORIGIN');
      headers.set('referrer-policy', 'same-origin');
    }

    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  }

  function json(body, code = statusCodes.OK, customHeaders = {}) {
    const headers = new Headers(customHeaders);
    headers.set('content-type', 'application/json; charset=utf-8');
    applyCommonHeaders(headers);

    return new Response(JSON.stringify(body), {
      status: code,
      headers,
    });
  }

  function text(body, code = statusCodes.OK, customHeaders = {}) {
    const headers = new Headers(customHeaders);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'text/plain; charset=utf-8');
    }
    applyCommonHeaders(headers);

    return new Response(body, {
      status: code,
      headers,
    });
  }

  function binary(body, code = statusCodes.OK, customHeaders = {}) {
    const headers = new Headers(customHeaders);
    applyCommonHeaders(headers);

    return new Response(body, {
      status: code,
      headers,
    });
  }

  function error(code, message, details, customHeaders = {}) {
    return json(errorPayload(code, message, details), code, customHeaders);
  }

  function preflight() {
    const headers = new Headers();
    headers.set('access-control-allow-methods', corsMethods.join(', '));
    headers.set('access-control-allow-headers', corsAllowedHeaders.join(', '));
    headers.set('access-control-max-age', '86400');

    if (context.cors.origin) {
      headers.set('access-control-allow-origin', context.cors.origin);
      headers.set('vary', 'Origin');
    }

    applyCommonHeaders(headers);
    return new Response(null, { status: statusCodes.NO_CONTENT, headers });
  }

  return {
    binary,
    error,
    json,
    preflight,
    text,
  };
}

function buildOpenApiSpec(basicAuthEnabled) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Toy API Server - Cloudflare Worker',
      version: '0.1.0',
      description:
        'Worker foundation with system routes and shared middleware behavior for the migration.',
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
              required: ['statusCode', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
    paths: {
      '/': { get: { summary: 'Show welcome message' } },
      '/health': { get: { summary: 'Check service health' } },
      '/docs': { get: { summary: 'Show docs entry page' } },
      '/openapi.json': { get: { summary: 'Fetch OpenAPI spec' } },
      '/api/toys': { post: { summary: 'Not implemented yet' } },
    },
    security: basicAuthEnabled ? [{ basicAuth: [] }] : [],
  };
}

async function serveAsset(pathname, request, env, response) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return response.error(statusCodes.NOT_FOUND, 'Asset not found');
  }

  const assetRequest = new Request(new URL(pathname, request.url), request);
  const assetResponse = await env.ASSETS.fetch(assetRequest);
  if (!assetResponse.ok) return response.error(statusCodes.NOT_FOUND, 'Asset not found');

  return response.binary(assetResponse.body, assetResponse.status, assetResponse.headers);
}

export default {
  async fetch(request, env) {
    const nodeEnv = env.NODE_ENV || 'development';

    const requestId = crypto.randomUUID();
    const correlationId = request.headers.get('x-correlation-id') || requestId;
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);
    const corsOrigin = request.headers.get('origin');
    const corsOptions = {
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
      nodeEnv,
    };

    const corsAllowed = isCorsOriginAllowed(corsOrigin, corsOptions, request);
    const context = {
      requestId,
      correlationId,
      cors: {
        origin: corsOrigin && corsAllowed ? corsOrigin : null,
      },
      securityHeaders: resolveSecurityHeadersOptions(env, nodeEnv),
    };
    const response = createResponseHelpers(context);

    if (request.method === 'OPTIONS') {
      if (!corsAllowed) {
        const corsFailure = buildCorsFailurePayload();
        return response.error(corsFailure.code, corsFailure.message);
      }

      return response.preflight();
    }

    if (!corsAllowed) {
      const corsFailure = buildCorsFailurePayload();
      return response.error(corsFailure.code, corsFailure.message);
    }

    const basicAuthOptions = resolveBasicAuthOptions(env);
    const authResult = checkBasicAuth(request, pathname, basicAuthOptions);
    if (!authResult.ok) {
      return response.error(authResult.code, authResult.message, undefined, {
        ...(authResult.headers || {}),
      });
    }

    try {
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

      if (pathname === '/favicon.ico' && request.method === 'GET') {
        return serveAsset('/favicon.ico', request, env, response);
      }

      if (pathname === '/favicon.png' && request.method === 'GET') {
        return serveAsset('/favicon.png', request, env, response);
      }

      if (pathname === '/docs' && request.method === 'GET') {
        return serveAsset('/docs.html', request, env, response);
      }

      if (pathname === '/openapi.json' && request.method === 'GET') {
        const spec = buildOpenApiSpec(resolveBasicAuthOptions(env).enabled);
        return response.json(spec);
      }

      if (pathname === '/404' && request.method === 'GET') {
        return response.error(statusCodes.NOT_FOUND, 'Route not found');
      }

      if (pathname === '/500' && request.method === 'GET') {
        return response.error(statusCodes.INTERNAL_SERVER_ERROR, 'Internal Server Error');
      }

      if (pathname.startsWith('/api/toys')) {
        return response.error(
          statusCodes.NOT_IMPLEMENTED,
          'Toy routes are not implemented yet',
        );
      }

      return response.error(statusCodes.NOT_FOUND, 'Route not found');
    } catch (error) {
      console.error('Unhandled request error', {
        error: String(error?.message || error),
        pathname,
      });

      return response.error(statusCodes.INTERNAL_SERVER_ERROR, 'Internal Server Error');
    }
  },

  async scheduled() {
    return;
  },
};
