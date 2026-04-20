const TOY_KEY_SEGMENT = 'toy';
const DEFAULT_CLOUDFLARE_KV_PREFIX = 'toy-api-server';
const DEFAULT_MAX_SCAN_KEYS = 5000;
const MAX_ID_ALLOCATION_ATTEMPTS = 12;
const MAX_SAFE_INTEGER_MASK = (1n << 53n) - 1n;

function generateRandomToyId() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    return Math.max(1, Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  }

  const randomParts = new Uint32Array(2);
  globalThis.crypto.getRandomValues(randomParts);

  const combined = (BigInt(randomParts[0]) << 32n) | BigInt(randomParts[1]);
  return Number((combined & MAX_SAFE_INTEGER_MASK) || 1n);
}

function resolveKvKeyPrefix(kvPrefix) {
  if (typeof kvPrefix !== 'string') return DEFAULT_CLOUDFLARE_KV_PREFIX;

  const normalizedPrefix = kvPrefix.trim().replace(/:+$/, '');
  return normalizedPrefix || DEFAULT_CLOUDFLARE_KV_PREFIX;
}

function toEpochMs(referenceTime) {
  if (referenceTime instanceof Date) return referenceTime.getTime();

  return new Date(referenceTime).getTime();
}

function toExpirationSeconds(dateInput) {
  const epochMs = toEpochMs(dateInput);
  if (!Number.isFinite(epochMs)) return null;

  return Math.floor(epochMs / 1000);
}

function isValidToyShape(toy) {
  if (!toy || typeof toy !== 'object') return false;
  if (!Number.isInteger(Number(toy.id))) return false;
  if (typeof toy.name !== 'string') return false;
  if (typeof toy.image !== 'string') return false;
  if (!Number.isInteger(Number(toy.likes))) return false;
  if (typeof toy.enabled !== 'boolean') return false;
  if (typeof toy.created_at !== 'string') return false;
  if (typeof toy.updated_at !== 'string') return false;
  if (typeof toy.expires_at !== 'string') return false;

  return true;
}

function normalizeToy(toy) {
  if (!isValidToyShape(toy)) return null;

  return {
    id: Number(toy.id),
    name: toy.name,
    image: toy.image,
    likes: Number(toy.likes),
    enabled: Boolean(toy.enabled),
    created_by_ip: toy.created_by_ip || null,
    created_at: toy.created_at,
    updated_at: toy.updated_at,
    expires_at: toy.expires_at,
  };
}

function isToyExpired(toy, referenceTime = new Date()) {
  const expiresAtMs = toEpochMs(toy?.expires_at);
  const referenceMs = toEpochMs(referenceTime);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(referenceMs)) return false;

  return expiresAtMs <= referenceMs;
}

export default class KvToyStore {
  constructor(kv, options = {}) {
    if (!kv) throw new Error('KvToyStore requires a KV binding');

    this.kv = kv;
    this.toyKeyPrefix = `${resolveKvKeyPrefix(options.kvPrefix)}:${TOY_KEY_SEGMENT}:`;
    this.maxScanKeys = Number.isFinite(Number(options.maxScanKeys))
      ? Math.max(100, Math.floor(Number(options.maxScanKeys)))
      : DEFAULT_MAX_SCAN_KEYS;
  }

  toyKey(id) {
    return `${this.toyKeyPrefix}${id}`;
  }

  async listToyKeyNames() {
    let cursor = undefined;
    let safetyCount = 0;
    const names = [];

    do {
      const page = await this.kv.list({
        prefix: this.toyKeyPrefix,
        cursor,
      });
      for (const key of page.keys || []) {
        names.push(key.name);
        if (names.length >= this.maxScanKeys) return names;
      }

      cursor = page.list_complete ? undefined : page.cursor;
      safetyCount += 1;
      if (safetyCount > this.maxScanKeys) break;
    } while (cursor);

    return names;
  }

  async getToyByKeyName(keyName, referenceTime = new Date()) {
    const rawToy = await this.kv.get(keyName, 'json');
    const toy = normalizeToy(rawToy);
    if (!toy) {
      await this.kv.delete(keyName);
      return null;
    }

    if (!isToyExpired(toy, referenceTime)) return toy;

    await this.kv.delete(keyName);
    return null;
  }

  async listToys(options = {}) {
    const { clientKey, enabledOnly = false, referenceTime = new Date() } = options;
    const names = await this.listToyKeyNames();
    const toys = [];

    for (const keyName of names) {
      const toy = await this.getToyByKeyName(keyName, referenceTime);
      if (!toy) continue;
      if (clientKey && toy.created_by_ip !== clientKey) continue;
      if (enabledOnly && !toy.enabled) continue;

      toys.push(toy);
    }

    toys.sort((left, right) => left.id - right.id);
    return toys;
  }

  async findToyById(id, options = {}) {
    const { referenceTime = new Date() } = options;
    const normalizedId = Number(id);
    if (!Number.isInteger(normalizedId)) return null;

    return this.getToyByKeyName(this.toyKey(normalizedId), referenceTime);
  }

  async nextToyId(referenceTime = new Date(), options = {}) {
    const { maxAttempts = MAX_ID_ALLOCATION_ATTEMPTS } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidateId = generateRandomToyId();
      const existingToy = await this.findToyById(candidateId, { referenceTime });
      if (!existingToy) return candidateId;
    }
    throw new Error(`Unable to allocate toy id after ${maxAttempts} attempts`);
  }

  async saveToy(toy) {
    const normalizedToy = normalizeToy(toy);
    if (!normalizedToy) {
      throw new Error('Cannot save invalid toy payload');
    }

    const expiration = toExpirationSeconds(normalizedToy.expires_at);
    if (!Number.isFinite(expiration)) {
      throw new Error('Toy expires_at must be a valid date-time string');
    }

    if (expiration <= Math.floor(Date.now() / 1000)) {
      await this.kv.delete(this.toyKey(normalizedToy.id));
      return normalizedToy;
    }

    await this.kv.put(this.toyKey(normalizedToy.id), JSON.stringify(normalizedToy), {
      expiration,
    });

    return normalizedToy;
  }

  async deleteToy(id) {
    const normalizedId = Number(id);
    if (!Number.isInteger(normalizedId)) return false;

    const existingToy = await this.findToyById(normalizedId);
    if (!existingToy) return false;

    await this.kv.delete(this.toyKey(normalizedId));
    return true;
  }

  async countToys(options = {}) {
    const toys = await this.listToys({ referenceTime: options.referenceTime });
    return toys.length;
  }

  async countToysByClientKey(clientKey, options = {}) {
    if (!clientKey) return 0;

    const toys = await this.listToys({
      clientKey,
      referenceTime: options.referenceTime,
    });

    return toys.length;
  }

  async pruneExpiredToys(referenceTime = new Date()) {
    const names = await this.listToyKeyNames();
    let removedCount = 0;

    for (const keyName of names) {
      const rawToy = await this.kv.get(keyName, 'json');
      const toy = normalizeToy(rawToy);

      if (!toy || isToyExpired(toy, referenceTime)) {
        await this.kv.delete(keyName);
        removedCount += 1;
      }
    }

    return removedCount;
  }
}
