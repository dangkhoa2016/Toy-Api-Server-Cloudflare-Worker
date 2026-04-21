import { statusCodes } from '../lib/variables.js';

export function notFound(response, headers = {}) {
  return response.error(statusCodes.NOT_FOUND, 'Route not found', undefined, headers);
}

export function exception(response, headers = {}) {
  return response.error(
    statusCodes.INTERNAL_SERVER_ERROR,
    'Internal Server Error',
    undefined,
    headers,
  );
}

export function handleErrorRoutes({ pathname, request, response, rateLimitHeaders = {} }) {
  if (pathname === '/404' && request.method === 'GET') {
    return notFound(response, rateLimitHeaders);
  }

  if (pathname === '/500' && request.method === 'GET') {
    return exception(response, rateLimitHeaders);
  }

  return null;
}
