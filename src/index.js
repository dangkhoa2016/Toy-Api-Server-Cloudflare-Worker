import {
  getToyPolicyDefaults,
  normalizePositiveInteger,
  parseBoolean,
  statusCodes,
} from './lib/variables.js';
import { checkBasicAuth, resolveBasicAuthOptions } from './lib/auth.js';
import { getClientKey, normalizePath } from './lib/request_client.js';
import {
  buildCorsFailurePayload,
  corsAllowedHeaders,
  corsExposedHeaders,
  corsMethods,
  isCorsOriginAllowed,
  parseCorsOrigins,
} from './lib/cors.js';
import { errorPayload } from './lib/http.js';
import { exception, handleErrorRoutes, notFound } from './routes/errors.js';
import { handleHomeRoutes } from './routes/home.js';
import { handleToysRoutes } from './routes/toys.js';
import ToysService from './services/toys_service.js';
import KvStateStore from './stores/kv_state_store.js';
import KvToyStore from './stores/kv_toy_store.js';

const DEFAULT_SKIPPED_RATE_LIMIT_PATHS = new Set([
  '/health',
  '/favicon.ico',
  '/favicon.png',
]);
const workerStartedAt = Date.now();

function resolveRateLimitOptions(env = {}, nodeEnv = 'development') {
  const toyPolicyDefaults = getToyPolicyDefaults(env);
  const enabled =
    typeof env.RATE_LIMIT_ENABLED !== 'undefined'
      ? parseBoolean(env.RATE_LIMIT_ENABLED, true)
      : nodeEnv !== 'test';
  const max = normalizePositiveInteger(env.RATE_LIMIT_MAX, 20);
  const windowMs = normalizePositiveInteger(
    env.RATE_LIMIT_WINDOW_MS,
    toyPolicyDefaults.rateLimitWindowMs,
    1000,
  );

  return {
    enabled,
    max,
    methods: ['POST'],
    paths: ['/api/toys'],
    windowMs,
  };
}

function resolveToyPolicyOptions(env = {}) {
  const toyPolicyDefaults = getToyPolicyDefaults(env);

  return {
    cleanupIntervalMs: normalizePositiveInteger(
      env.TOY_CLEANUP_INTERVAL_MS,
      toyPolicyDefaults.cleanupIntervalMs,
      1000,
    ),
    maxActiveToysGlobal: normalizePositiveInteger(
      env.MAX_ACTIVE_TOYS_GLOBAL,
      toyPolicyDefaults.maxActiveToysGlobal,
    ),
    maxToysPerIp: normalizePositiveInteger(
      env.MAX_TOYS_PER_IP,
      toyPolicyDefaults.maxToysPerIp,
    ),
    seedMaxToysPerIp: normalizePositiveInteger(
      env.SEED_MAX_TOYS_PER_IP,
      toyPolicyDefaults.seedMaxToysPerIp,
    ),
    seedWindowMs: normalizePositiveInteger(
      env.SEED_WINDOW_MS,
      toyPolicyDefaults.seedWindowMs,
      1000,
    ),
    toyTtlMs: normalizePositiveInteger(env.TOY_TTL_MS, toyPolicyDefaults.toyTtlMs, 1000),
  };
}

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

    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'no-store');
    }
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

async function applyRateLimitIfNeeded(request, pathname, options, store) {
  if (!options.enabled) return { headers: {} };
  if (request.method === 'OPTIONS') return { headers: {} };
  if (DEFAULT_SKIPPED_RATE_LIMIT_PATHS.has(pathname)) return { headers: {} };

  const allowedMethods = new Set(
    (options.methods || []).map((method) => String(method).toUpperCase()),
  );
  const allowedPaths = new Set(
    (options.paths || []).map((routePath) => normalizePath(routePath)),
  );
  if (!allowedMethods.has(request.method.toUpperCase())) return { headers: {} };
  if (!allowedPaths.has(pathname)) return { headers: {} };

  const clientKey = getClientKey(request);
  const now = Date.now();
  const currentEntry = await store.getRateLimit(clientKey);
  const resetAt =
    currentEntry && Number.isFinite(currentEntry.resetAt) && currentEntry.resetAt > now
      ? currentEntry.resetAt
      : now + options.windowMs;
  const nextEntry =
    currentEntry && currentEntry.resetAt > now
      ? { ...currentEntry }
      : {
          count: 0,
          resetAt,
        };

  nextEntry.count += 1;
  await store.setRateLimit(clientKey, nextEntry, {
    windowMs: options.windowMs,
  });

  const remaining = Math.max(0, options.max - nextEntry.count);
  const headers = {
    'x-ratelimit-limit': String(options.max),
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(Math.ceil(nextEntry.resetAt / 1000)),
  };

  if (nextEntry.count <= options.max) {
    return {
      headers,
    };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((nextEntry.resetAt - now) / 1000));
  headers['retry-after'] = String(retryAfterSeconds);

  return {
    blocked: true,
    retryAfterSeconds,
    headers,
  };
}

function ensureBindings(env) {
  if (!env.TOY_STATE) {
    throw new Error('Missing KV binding: TOY_STATE');
  }
}

export default {
  async fetch(request, env) {
    const nodeEnv = env.NODE_ENV || 'development';

    const requestId = crypto.randomUUID();
    const correlationId = request.headers.get('x-correlation-id') || requestId;
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);
    const isAssetReadMethod = request.method === 'GET' || request.method === 'HEAD';
    const corsOrigin = request.headers.get('origin');
    const corsOptions = {
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
      nodeEnv,
    };
    const securityHeadersOptions = resolveSecurityHeadersOptions(env, nodeEnv);

    const corsAllowed = isCorsOriginAllowed(corsOrigin, corsOptions, request);
    const context = {
      requestId,
      correlationId,
      cors: {
        origin: corsOrigin && corsAllowed ? corsOrigin : null,
      },
      securityHeaders: securityHeadersOptions,
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

    let rateLimitHeaders = {};

    try {
      ensureBindings(env);
      const stateStore = new KvStateStore(env.TOY_STATE);
      const toyStore = new KvToyStore(env.TOY_STATE);

      const rateLimitOptions = resolveRateLimitOptions(env, nodeEnv);
      const rateLimitState = await applyRateLimitIfNeeded(
        request,
        pathname,
        rateLimitOptions,
        stateStore,
      );
      rateLimitHeaders = rateLimitState.headers || {};
      if (rateLimitState.blocked) {
        return response.error(
          statusCodes.TOO_MANY_REQUESTS,
          'Rate limit exceeded',
          {
            limit: rateLimitOptions.max,
            retryAfterSeconds: rateLimitState.retryAfterSeconds,
            windowMs: rateLimitOptions.windowMs,
          },
          rateLimitHeaders,
        );
      }

      const basicAuthOptions = resolveBasicAuthOptions(env);
      const authResult = checkBasicAuth(request, pathname, basicAuthOptions);
      if (!authResult.ok) {
        return response.error(authResult.code, authResult.message, undefined, {
          ...rateLimitHeaders,
          ...(authResult.headers || {}),
        });
      }

      const toyPolicyOptions = resolveToyPolicyOptions(env);
      const toysService = new ToysService({
        env,
        maxActiveToysGlobal: toyPolicyOptions.maxActiveToysGlobal,
        maxToysPerIp: toyPolicyOptions.maxToysPerIp,
        seedMaxToysPerIp: toyPolicyOptions.seedMaxToysPerIp,
        seedWindowMs: toyPolicyOptions.seedWindowMs,
        stateStore,
        toyStore,
        toyTtlMs: toyPolicyOptions.toyTtlMs,
      });

      await toysService.pruneExpiredToys();

      const homeRouteResponse = await handleHomeRoutes({
        basicAuthEnabled: basicAuthOptions.enabled,
        env,
        isAssetReadMethod,
        pathname,
        request,
        response,
        workerStartedAt,
      });
      if (homeRouteResponse) {
        return homeRouteResponse;
      }

      const errorRouteResponse = handleErrorRoutes({
        pathname,
        request,
        response,
        rateLimitHeaders,
      });
      if (errorRouteResponse) {
        return errorRouteResponse;
      }

      const toysRouteResponse = await handleToysRoutes({
        pathname,
        request,
        response,
        rateLimitHeaders,
        toysService,
      });
      if (toysRouteResponse) {
        return toysRouteResponse;
      }

      return notFound(response, rateLimitHeaders);
    } catch (error) {
      console.error('Unhandled request error', {
        error: String(error?.message || error),
        pathname,
      });

      return exception(response, rateLimitHeaders);
    }
  },

  async scheduled(_event, env) {
    try {
      if (!env.TOY_STATE) return;

      const toyStore = new KvToyStore(env.TOY_STATE);
      await toyStore.pruneExpiredToys(new Date());
    } catch (error) {
      console.error('Scheduled cleanup failed', String(error?.message || error));
    }
  },
};
