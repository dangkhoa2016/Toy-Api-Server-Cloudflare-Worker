function normalizeTtlSeconds(windowMs, additionalSeconds = 60) {
  const seconds = Math.ceil(Number(windowMs) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 120;

  return Math.max(60, seconds + additionalSeconds);
}

export default class KvStateStore {
  constructor(kv) {
    if (!kv) throw new Error('KvStateStore requires a KV binding');

    this.kv = kv;
  }

  getRateLimitKey(clientKey) {
    return `ratelimit:${clientKey}`;
  }

  getSeedKey(clientKey) {
    return `seed:${clientKey}`;
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
