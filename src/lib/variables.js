export const statusCodes = {
  OK: 200,
  DATA_CREATED: 201,
  NO_CONTENT: 204,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

export const toyConstraints = {
  imageProtocols: ['http:', 'https:'],
  maxNameLength: 120,
  minNameLength: 2,
};

export const timeConstants = {
  MS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
};

timeConstants.MS_PER_MINUTE =
  timeConstants.SECONDS_PER_MINUTE * timeConstants.MS_PER_SECOND;

export const toyPolicyFallbacks = {
  cleanupIntervalMinutes: 1,
  maxActiveToysGlobal: 500,
  maxToysPerIp: 5,
  rateLimitWindowMinutes: 5,
  seedMaxToysPerIp: 15,
  seedWindowMinutes: 10,
  toyTtlMinutes: 15,
};

export function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return fallback;
}

export function normalizePositiveInteger(value, fallback, minimum = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;

  return Math.max(minimum, Math.floor(numericValue));
}

function readPositiveIntegerEnv(env, envName) {
  const numericValue = Number(env?.[envName]);
  if (!Number.isFinite(numericValue)) return null;

  return Math.max(1, Math.floor(numericValue));
}

export function getToyPolicyDefaults(env = {}) {
  const seedWindowMinutes =
    readPositiveIntegerEnv(env, 'DEFAULT_SEED_WINDOW_MINUTES') ??
    toyPolicyFallbacks.seedWindowMinutes;
  const toyTtlMinutes =
    readPositiveIntegerEnv(env, 'DEFAULT_TOY_TTL_MINUTES') ??
    toyPolicyFallbacks.toyTtlMinutes;
  const cleanupIntervalMinutes =
    readPositiveIntegerEnv(env, 'DEFAULT_TOY_CLEANUP_INTERVAL_MINUTES') ??
    toyPolicyFallbacks.cleanupIntervalMinutes;
  const rateLimitWindowMinutes =
    readPositiveIntegerEnv(env, 'DEFAULT_RATE_LIMIT_WINDOW_MINUTES') ??
    toyPolicyFallbacks.rateLimitWindowMinutes;

  return {
    cleanupIntervalMs: cleanupIntervalMinutes * timeConstants.MS_PER_MINUTE,
    maxActiveToysGlobal:
      readPositiveIntegerEnv(env, 'DEFAULT_MAX_ACTIVE_TOYS_GLOBAL') ??
      toyPolicyFallbacks.maxActiveToysGlobal,
    maxToysPerIp:
      readPositiveIntegerEnv(env, 'DEFAULT_MAX_TOYS_PER_IP') ??
      toyPolicyFallbacks.maxToysPerIp,
    rateLimitWindowMs: rateLimitWindowMinutes * timeConstants.MS_PER_MINUTE,
    seedMaxToysPerIp:
      readPositiveIntegerEnv(env, 'DEFAULT_SEED_MAX_TOYS_PER_IP') ??
      toyPolicyFallbacks.seedMaxToysPerIp,
    seedWindowMs: seedWindowMinutes * timeConstants.MS_PER_MINUTE,
    toyTtlMs: toyTtlMinutes * timeConstants.MS_PER_MINUTE,
  };
}
