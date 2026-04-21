function normalizeTtlSeconds(windowMs, additionalSeconds = 60) {
  const seconds = Math.ceil(Number(windowMs) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 120;

  return Math.max(60, seconds + additionalSeconds);
}

const DEFAULT_CLOUDFLARE_KV_PREFIX = 'toy-api-server';

function resolveKvKeyPrefix(kvPrefix) {
  if (typeof kvPrefix !== 'string') return DEFAULT_CLOUDFLARE_KV_PREFIX;

  const normalizedPrefix = kvPrefix.trim().replace(/:+$/, '');
  return normalizedPrefix || DEFAULT_CLOUDFLARE_KV_PREFIX;
}

export default class KvStateStore {
  constructor(kv, options = {}) {
    if (!kv) throw new Error('KvStateStore requires a KV binding');

    this.kv = kv;
    this.kvPrefix = resolveKvKeyPrefix(options.kvPrefix);
    this.rateLimitKeyPrefix = `${this.kvPrefix}:ratelimit:`;
    this.seedKeyPrefix = `${this.kvPrefix}:seed:`;
  }

  getRateLimitKey(clientKey) {
    return `${this.rateLimitKeyPrefix}${clientKey}`;
  }

  getSeedKey(clientKey) {
    return `${this.seedKeyPrefix}${clientKey}`;
  }

  async getRateLimit(clientKey) {
    if (!clientKey) return null;

    const entry = await this.kv.get(this.getRateLimitKey(clientKey), 'json');
    if (!entry || typeof entry !== 'object') return null;

    const count = Number(entry.count);
    const resetAt = Number(entry.resetAt);
    if (!Number.isFinite(count) || !Number.isFinite(resetAt)) return null;

    return {
      count,
      resetAt,
    };
  }

  async setRateLimit(clientKey, value, options = {}) {
    if (!clientKey) return null;

    const expirationTtl = normalizeTtlSeconds(options.windowMs, 60);
    await this.kv.put(this.getRateLimitKey(clientKey), JSON.stringify(value), {
      expirationTtl,
    });

    return value;
  }

  async getSeedState(clientKey) {
    if (!clientKey) return null;

    const entry = await this.kv.get(this.getSeedKey(clientKey), 'json');
    if (!entry || typeof entry !== 'object') return null;

    const firstCreateAt = Number(entry.firstCreateAt);
    const successfulCreates = Number(entry.successfulCreates);
    if (!Number.isFinite(firstCreateAt) || !Number.isFinite(successfulCreates)) {
      return null;
    }

    return {
      firstCreateAt,
      successfulCreates,
    };
  }

  async setSeedState(clientKey, value, options = {}) {
    if (!clientKey) return null;

    const expirationTtl = normalizeTtlSeconds(options.retentionMs, 180);
    await this.kv.put(this.getSeedKey(clientKey), JSON.stringify(value), {
      expirationTtl,
    });

    return value;
  }
}
