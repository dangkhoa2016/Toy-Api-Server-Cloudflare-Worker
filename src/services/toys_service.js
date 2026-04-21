import {
  getToyPolicyDefaults,
  normalizePositiveInteger,
  statusCodes,
  toyConstraints,
} from '../lib/variables.js';

function normalizeId(id) {
  if (id === null || typeof id === 'undefined' || id === '') return null;

  const numericId = Number(id);
  return Number.isInteger(numericId) ? numericId : null;
}

function isValidImageUri(image) {
  try {
    const parsedUrl = new URL(image);
    return toyConstraints.imageProtocols.includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function validateName(name) {
  if (typeof name !== 'string') return 'Toy name is required';

  const trimmedName = name.trim();
  if (!trimmedName) return 'Toy name is required';

  if (trimmedName.length < toyConstraints.minNameLength) {
    return `Toy name must be at least ${toyConstraints.minNameLength} characters long`;
  }

  if (trimmedName.length > toyConstraints.maxNameLength) {
    return `Toy name must be at most ${toyConstraints.maxNameLength} characters long`;
  }

  return null;
}

function validateLikes(likes) {
  if (typeof likes !== 'undefined' && (!Number.isInteger(likes) || likes < 0)) {
    return 'Likes must be an integer greater than or equal to 0';
  }

  return null;
}

function validateImage(image) {
  if (typeof image !== 'string' || !image.trim()) return 'Toy image is required';
  if (!isValidImageUri(image)) return 'Toy image must be a valid URI';

  return null;
}

export default class ToysService {
  constructor(options = {}) {
    const toyPolicyDefaults = getToyPolicyDefaults(options.env);
    const {
      maxActiveToysGlobal,
      maxToysPerIp,
      seedMaxToysPerIp,
      seedWindowMs,
      stateStore,
      toyStore,
      toyTtlMs,
    } = options;

    if (!toyStore) throw new Error('ToysService requires a toy store');
    if (!stateStore) throw new Error('ToysService requires a state store');

    this.maxActiveToysGlobal = normalizePositiveInteger(
      maxActiveToysGlobal ?? toyPolicyDefaults.maxActiveToysGlobal,
      toyPolicyDefaults.maxActiveToysGlobal,
    );
    this.maxToysPerIp = normalizePositiveInteger(
      maxToysPerIp ?? toyPolicyDefaults.maxToysPerIp,
      toyPolicyDefaults.maxToysPerIp,
    );
    this.seedMaxToysPerIp = normalizePositiveInteger(
      seedMaxToysPerIp ?? toyPolicyDefaults.seedMaxToysPerIp,
      toyPolicyDefaults.seedMaxToysPerIp,
    );
    this.seedWindowMs = normalizePositiveInteger(
      seedWindowMs ?? toyPolicyDefaults.seedWindowMs,
      toyPolicyDefaults.seedWindowMs,
    );
    this.stateStore = stateStore;
    this.toyStore = toyStore;
    this.toyTtlMs = normalizePositiveInteger(
      toyTtlMs ?? toyPolicyDefaults.toyTtlMs,
      toyPolicyDefaults.toyTtlMs,
    );
  }

  async getSeedState(clientKey, referenceTime = Date.now()) {
    const seedState = await this.stateStore.getSeedState(clientKey);
    if (!seedState) return null;

    const firstCreateAt = Number(seedState.firstCreateAt);
    const successfulCreates = Number(seedState.successfulCreates);
    if (!Number.isFinite(firstCreateAt) || !Number.isFinite(successfulCreates)) {
      return null;
    }

    const seedExpiresAt = firstCreateAt + this.seedWindowMs;
    return {
      firstCreateAt,
      isActive: referenceTime < seedExpiresAt && successfulCreates < this.seedMaxToysPerIp,
      seedExpiresAt,
      successfulCreates,
    };
  }

  async pruneExpiredToys(referenceTime = new Date()) {
    return this.toyStore.pruneExpiredToys(referenceTime);
  }

  sanitizeToy(toy) {
    if (!toy) return toy;

    const { created_by_ip: _createdByIp, expires_at: _expiresAt, ...publicToy } = toy;
    return publicToy;
  }

  async getToys(enabledOnly = false) {
    await this.pruneExpiredToys();

    const toys = await this.toyStore.listToys({ enabledOnly });
    return toys.map((toy) => this.sanitizeToy(toy));
  }

  async saveToy(data) {
    await this.pruneExpiredToys();

    if (!data) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: 'Toy payload is required',
      };
    }

    const nameError = validateName(data.name);
    if (nameError) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: nameError,
      };
    }

    const imageError = validateImage(data.image);
    if (imageError) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: imageError,
      };
    }

    const likesError = validateLikes(data.likes);
    if (likesError) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: likesError,
      };
    }

    const payload = { ...data };
    let existingToy = null;

    if (typeof payload.id !== 'undefined') {
      const normalizedId = normalizeId(payload.id);
      if (normalizedId === null) {
        return {
          code: statusCodes.UNPROCESSABLE_ENTITY,
          error: 'Toy id must be an integer',
        };
      }

      payload.id = normalizedId;
      existingToy = await this.toyStore.findToyById(normalizedId);
    }

    payload.image = payload.image.trim();
    payload.name = payload.name.trim();

    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const createdAt = existingToy ? existingToy.created_at : payload.created_at || timestamp;
    const likes = typeof payload.likes === 'number' ? payload.likes : existingToy?.likes || 0;
    const enabled =
      typeof payload.enabled === 'boolean' ? payload.enabled : (existingToy?.enabled ?? true);

    const toy = {
      ...existingToy,
      ...payload,
      created_by_ip: existingToy?.created_by_ip ?? payload.created_by_ip,
      created_at: createdAt,
      expires_at:
        existingToy?.expires_at ||
        payload.expires_at ||
        new Date(now + this.toyTtlMs).toISOString(),
      updated_at: timestamp,
      likes,
      enabled,
    };

    if (typeof toy.id === 'undefined') {
      toy.id = await this.toyStore.nextToyId();
    }

    await this.toyStore.saveToy(toy);

    return {
      code: existingToy ? statusCodes.OK : statusCodes.DATA_CREATED,
      data: this.sanitizeToy(toy),
    };
  }

  async createToy(data, options = {}) {
    await this.pruneExpiredToys();

    if (!data) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: 'Toy payload is required',
      };
    }

    const clientKey = options.clientKey || 'unknown';
    const now = Date.now();
    const seedState = await this.getSeedState(clientKey, now);
    const allowedToyLimit = seedState?.isActive ? this.seedMaxToysPerIp : this.maxToysPerIp;

    const activeGlobalToyCount = await this.toyStore.countToys({
      referenceTime: new Date(now),
    });
    if (activeGlobalToyCount >= this.maxActiveToysGlobal) {
      return {
        code: statusCodes.TOO_MANY_REQUESTS,
        error: 'Toy capacity exceeded for this service',
        details: {
          limit: this.maxActiveToysGlobal,
          scope: 'global',
          ttlMs: this.toyTtlMs,
        },
      };
    }

    const activeToyCount = await this.toyStore.countToysByClientKey(clientKey, {
      referenceTime: new Date(now),
    });
    if (activeToyCount >= allowedToyLimit) {
      return {
        code: statusCodes.TOO_MANY_REQUESTS,
        error: 'Toy quota exceeded for this IP address',
        details: {
          defaultLimit: this.maxToysPerIp,
          limit: allowedToyLimit,
          seedLimit: this.seedMaxToysPerIp,
          seedMode: Boolean(seedState?.isActive),
          seedWindowMs: this.seedWindowMs,
          ttlMs: this.toyTtlMs,
        },
      };
    }

    const payload = { ...data };
    payload.created_by_ip = clientKey;
    payload.expires_at = new Date(now + this.toyTtlMs).toISOString();
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    const result = await this.saveToy(payload);
    if (result.data) {
      await this.stateStore.setSeedState(
        clientKey,
        {
          firstCreateAt: seedState?.firstCreateAt ?? now,
          successfulCreates: (seedState?.successfulCreates ?? 0) + 1,
        },
        {
          retentionMs: this.seedWindowMs + this.toyTtlMs,
        },
      );
    }

    return result;
  }

  async deleteToy(id) {
    await this.pruneExpiredToys();

    const normalizedId = normalizeId(id);
    if (normalizedId === null) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: 'Toy id is required',
      };
    }

    const deleted = await this.toyStore.deleteToy(normalizedId);
    if (!deleted) {
      return {
        code: statusCodes.NOT_FOUND,
        error: `Toy with id: [${normalizedId}] not found`,
      };
    }

    return {
      code: statusCodes.OK,
      data: { deleted: true },
    };
  }

  async getToy(id) {
    await this.pruneExpiredToys();

    const normalizedId = normalizeId(id);
    if (normalizedId === null) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: 'Toy id is required',
      };
    }

    const toy = await this.toyStore.findToyById(normalizedId);
    if (!toy) {
      return {
        code: statusCodes.NOT_FOUND,
        error: `Toy with id: [${normalizedId}] not found`,
      };
    }

    return {
      code: statusCodes.OK,
      data: this.sanitizeToy(toy),
    };
  }

  async likeToy(id, likes) {
    await this.pruneExpiredToys();

    const normalizedId = normalizeId(id);
    if (normalizedId === null) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: 'Toy id is required',
      };
    }

    const likesError = validateLikes(likes);
    if (likesError) {
      return {
        code: statusCodes.UNPROCESSABLE_ENTITY,
        error: likesError,
      };
    }

    const toy = await this.toyStore.findToyById(normalizedId);
    if (!toy) {
      return {
        code: statusCodes.NOT_FOUND,
        error: `Toy with id: [${normalizedId}] not found`,
      };
    }

    const updatedToy = {
      ...toy,
      likes,
      updated_at: new Date().toISOString(),
    };

    await this.toyStore.saveToy(updatedToy);
    return {
      code: statusCodes.OK,
      data: this.sanitizeToy(updatedToy),
    };
  }
}
