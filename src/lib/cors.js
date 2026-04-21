import { statusCodes } from './variables.js';

export const corsAllowedHeaders = [
  'Authorization',
  'Content-Type',
  'Location',
  'X-Correlation-Id',
  'X-Request-Id',
];

export const corsExposedHeaders = [
  'Content-Disposition',
  'X-Correlation-Id',
  'X-Request-Id',
];

export const corsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function parseCorsOrigins(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((origin) => String(origin).trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseUrl(value) {
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function isLoopbackOrigin(origin) {
  const parsedOrigin = parseUrl(origin);
  if (!parsedOrigin) return false;

  return isLoopbackHostname(parsedOrigin.hostname);
}

function getRequestPublicOrigin(request) {
  const forwardedProtocol =
    request.headers.get('x-forwarded-proto') ||
    request.headers.get('x-forwarded-scheme') ||
    request.headers.get('x-scheme');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host');

  const requestUrl = new URL(request.url);
  const protocol = forwardedProtocol || requestUrl.protocol.replace(':', '');
  if (!host || !protocol) return null;

  return `${protocol}://${host}`;
}

function isSameOrigin(left, right) {
  const leftUrl = parseUrl(left);
  const rightUrl = parseUrl(right);
  if (!leftUrl || !rightUrl) return false;

  return leftUrl.origin === rightUrl.origin;
}

function isTrustedDocsProxyOrigin(origin, trustedOrigins, request) {
  if (!isLoopbackOrigin(origin)) return false;

  const referer = parseUrl(request.headers.get('referer'));
  if (!referer || !referer.pathname.startsWith('/docs')) return false;

  if (trustedOrigins.has(referer.origin)) return true;

  const requestPublicOrigin = getRequestPublicOrigin(request);
  if (!requestPublicOrigin) return false;

  return isSameOrigin(referer.origin, requestPublicOrigin);
}

export function isCorsOriginAllowed(origin, options = {}, request) {
  const { corsOrigins = [], nodeEnv = 'development' } = options;
  const trustedOrigins = new Set(parseCorsOrigins(corsOrigins));
  const isProduction = nodeEnv === 'production';

  if (!origin) return true;
  if (!isProduction && trustedOrigins.size === 0) return true;
  if (!isProduction && isLoopbackOrigin(origin)) return true;
  if (trustedOrigins.has(origin)) return true;

  const requestPublicOrigin = getRequestPublicOrigin(request);
  if (
    requestPublicOrigin &&
    isSameOrigin(origin, requestPublicOrigin) &&
    (trustedOrigins.has(requestPublicOrigin) || !isProduction)
  ) {
    return true;
  }

  if (isTrustedDocsProxyOrigin(origin, trustedOrigins, request)) return true;

  return false;
}

export function buildCorsFailurePayload() {
  return {
    code: statusCodes.FORBIDDEN,
    message: 'Origin is not allowed by CORS',
  };
}
