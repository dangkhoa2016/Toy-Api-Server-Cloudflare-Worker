import { getClientKey } from '../lib/request_client.js';
import { statusCodes } from '../lib/variables.js';
import {
  parseIdSegment,
  readJsonBody,
  validateLikeMutationBody,
  validateToyMutationBody,
} from '../lib/validation.js';

const updateActions = new Set(['POST', 'PUT', 'PATCH']);

function parseRouteParams(pathname) {
  const likesMatch = pathname.match(/^\/api\/toys\/([^/]+)\/likes$/);
  if (likesMatch) {
    return {
      kind: 'likes',
      idSegment: likesMatch[1],
    };
  }

  const toyMatch = pathname.match(/^\/api\/toys\/([^/]+)$/);
  if (toyMatch) {
    return {
      kind: 'toy',
      idSegment: toyMatch[1],
    };
  }

  return null;
}

function sendError(response, code, message, details, headers = {}) {
  return response.error(code, message, details, headers);
}

export async function handleToysRoutes({
  pathname,
  request,
  response,
  toysService,
  rateLimitHeaders = {},
}) {
  if (!toysService) {
    throw new Error('Toys routes require toysService');
  }

  async function saveToy(id, body) {
    const { name = '', image = '', likes } = body || {};
    const payload = { id, name, image };
    if (typeof likes === 'number') payload.likes = likes;

    const {
      code = statusCodes.UNPROCESSABLE_ENTITY,
      data,
      error,
    } = await toysService.saveToy(payload);
    if (data) return response.json(data, code, rateLimitHeaders);

    return sendError(
      response,
      code,
      error || 'Unable to save toy',
      undefined,
      rateLimitHeaders,
    );
  }

  async function createToy(body) {
    const clientKey = getClientKey(request);
    const { name = '', likes = 0, image = '' } = body || {};

    const {
      code = statusCodes.UNPROCESSABLE_ENTITY,
      data,
      details,
      error,
    } = await toysService.createToy({ name, likes, image }, { clientKey });
    if (data) return response.json(data, code, rateLimitHeaders);

    return sendError(
      response,
      code,
      error || 'Unable to create toy',
      details,
      rateLimitHeaders,
    );
  }

  async function deleteToy(id) {
    const {
      code = statusCodes.UNPROCESSABLE_ENTITY,
      data,
      error,
    } = await toysService.deleteToy(id);
    if (data) return response.json(data, code, rateLimitHeaders);

    return sendError(
      response,
      code,
      error || 'Unable to delete toy',
      undefined,
      rateLimitHeaders,
    );
  }

  async function getToy(id) {
    const {
      code = statusCodes.NOT_FOUND,
      data,
      error,
    } = await toysService.getToy(id);
    if (data) return response.json(data, code, rateLimitHeaders);

    return sendError(
      response,
      code,
      error || 'Toy not found',
      undefined,
      rateLimitHeaders,
    );
  }

  async function likeToy(id, body) {
    const { likes = 0 } = body || {};
    const {
      code = statusCodes.NOT_FOUND,
      data,
      error,
    } = await toysService.likeToy(id, likes);
    if (data) return response.json(data, code, rateLimitHeaders);

    return sendError(
      response,
      code,
      error || 'Unable to update likes',
      undefined,
      rateLimitHeaders,
    );
  }

  if (pathname === '/api/toys' && request.method === 'GET') {
    const toys = await toysService.getToys();
    return response.json(toys, statusCodes.OK, rateLimitHeaders);
  }

  if (pathname === '/api/toys/export' && request.method === 'GET') {
    const toys = await toysService.getToys();
    const fileName = `export-toys-${Date.now()}.json`;

    return response.text(JSON.stringify(toys), statusCodes.OK, {
      ...rateLimitHeaders,
      'content-disposition': `attachment; filename=${fileName}`,
      'content-type': 'application/json',
    });
  }

  if (pathname === '/api/toys' && request.method === 'POST') {
    const body = await readJsonBody(request);
    if (body === Symbol.for('invalid-json')) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        'Request body must be valid JSON',
        undefined,
        rateLimitHeaders,
      );
    }

    const validationError = validateToyMutationBody(body);
    if (validationError) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        validationError,
        undefined,
        rateLimitHeaders,
      );
    }

    return createToy(body);
  }

  const params = parseRouteParams(pathname);
  if (params?.kind === 'likes' && updateActions.has(request.method.toUpperCase())) {
    const parsedId = parseIdSegment(params.idSegment);
    if (parsedId.error) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        parsedId.error,
        undefined,
        rateLimitHeaders,
      );
    }

    const body = await readJsonBody(request);
    if (body === Symbol.for('invalid-json')) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        'Request body must be valid JSON',
        undefined,
        rateLimitHeaders,
      );
    }

    const validationError = validateLikeMutationBody(body);
    if (validationError) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        validationError,
        undefined,
        rateLimitHeaders,
      );
    }

    return likeToy(parsedId.id, body);
  }

  if (params?.kind === 'toy') {
    const parsedId = parseIdSegment(params.idSegment);
    if (parsedId.error) {
      return sendError(
        response,
        statusCodes.UNPROCESSABLE_ENTITY,
        parsedId.error,
        undefined,
        rateLimitHeaders,
      );
    }

    if (request.method === 'GET') {
      return getToy(parsedId.id);
    }

    if (request.method === 'DELETE') {
      return deleteToy(parsedId.id);
    }

    if (updateActions.has(request.method.toUpperCase())) {
      const body = await readJsonBody(request);
      if (body === Symbol.for('invalid-json')) {
        return sendError(
          response,
          statusCodes.UNPROCESSABLE_ENTITY,
          'Request body must be valid JSON',
          undefined,
          rateLimitHeaders,
        );
      }

      const validationError = validateToyMutationBody(body);
      if (validationError) {
        return sendError(
          response,
          statusCodes.UNPROCESSABLE_ENTITY,
          validationError,
          undefined,
          rateLimitHeaders,
        );
      }

      return saveToy(parsedId.id, body);
    }
  }

  return null;
}
