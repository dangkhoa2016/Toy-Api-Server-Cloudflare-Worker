import { parseBoolean, statusCodes } from './constants.js';

const DEFAULT_REALM = 'Toy API';
const DEFAULT_SKIPPED_PATHS = ['/health', '/favicon.ico', '/favicon.png'];

function decodeCredentials(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('Basic ')) {
    return null;
  }

  try {
    const encoded = headerValue.slice(6).trim();
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText.length !== rightText.length) return false;

  let mismatch = 0;
  for (let index = 0; index < leftText.length; index += 1) {
    mismatch |= leftText.charCodeAt(index) ^ rightText.charCodeAt(index);
  }

  return mismatch === 0;
}

function credentialsMatch(credentials, expectedUsername, expectedPassword) {
  if (!credentials) return false;

  return (
    safeEqual(credentials.username, expectedUsername) &&
    safeEqual(credentials.password, expectedPassword)
  );
}

export function resolveBasicAuthOptions(env = {}) {
  return {
    enabled: parseBoolean(env.BASIC_AUTH_ENABLED, false),
    username: env.BASIC_AUTH_USERNAME || '',
    password: env.BASIC_AUTH_PASSWORD || '',
    realm: env.BASIC_AUTH_REALM || DEFAULT_REALM,
    skippedPaths: new Set(DEFAULT_SKIPPED_PATHS),
  };
}

export function checkBasicAuth(request, pathname, options) {
  if (!options.enabled) return { ok: true };
  if (request.method === 'OPTIONS') return { ok: true };
  if (options.skippedPaths.has(pathname)) return { ok: true };

  if (!options.username || !options.password) {
    return {
      ok: false,
      code: statusCodes.INTERNAL_SERVER_ERROR,
      message: 'Basic auth middleware requires username and password',
    };
  }

  const credentials = decodeCredentials(request.headers.get('authorization'));
  if (credentialsMatch(credentials, options.username, options.password)) {
    return { ok: true };
  }

  return {
    ok: false,
    code: statusCodes.UNAUTHORIZED,
    message: 'Authentication required',
    headers: {
      'www-authenticate': `Basic realm="${options.realm}"`,
    },
  };
}
