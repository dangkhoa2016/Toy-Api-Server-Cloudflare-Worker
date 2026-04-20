const CLOUDFLARE_KV_PREFIX = '';

export class KVService {
  constructor(cloudflareKv) {
    this.kv = cloudflareKv;
    this.cache = new Map();
    this.defaultCacheTTL = 300000; // 5 minutes
    console.log('KVService initialized');
  }

  /**
   * Get KV value with caching and circuit breaker
   * @param {string} key - Name of the KV key
   * @param {*} defaultValue - Default value if key not found
   * @param {boolean} useCache - Whether to use cache (default: true)
   * @returns {Promise<*>} KV value
   */
  async get(key, defaultValue = null, useCache = true) {
    if (!key || typeof key !== 'string') {
      console.log(`Invalid key: ${key}`);
      return defaultValue;
    }

    // Check if the key has a prefix
    if (!key.startsWith(CLOUDFLARE_KV_PREFIX)) {
      key = this.realKey(key);
      console.log(`Key without prefix, using real key: ${key}`);
    }

    try {
      // Check cache first
      if (useCache && this.cache.has(key)) {
        const cached = this.cache.get(key);
        if (Date.now() < cached.expiry) {
          console.log(`Cache hit for key: ${key}`);
          return cached.value;
        }
        this.cache.delete(key);
      }

      // Get from KV with circuit breaker
      const value = await this.getWithCircuitBreaker(key, defaultValue);

      if (value === null) {
        console.log(`Key not found in KV: ${key}, using default: ${defaultValue}`);
        return defaultValue;
      }

      const parsedValue = this.parseValue(value);

      // Cache the result
      if (useCache) {
        this.cache.set(key, {
          value: parsedValue,
          expiry: Date.now() + this.defaultCacheTTL
        });
      }

      console.log(`Retrieved from KV: ${key} = ${parsedValue}`);
      return parsedValue;
    } catch (error) {
      console.log(`Error getting key ${key}: ${error.message}`);
      return defaultValue;
    }
  }

  /**
   * Set KV value
   */
  async set(key, value) {
    if (!key || typeof key !== 'string') {
      console.log(`Invalid key: ${key}`);
      return false;
    }

    // Check if the key has a prefix
    if (!key.startsWith(CLOUDFLARE_KV_PREFIX)) {
      key = this.realKey(key);
      console.log(`Key without prefix, using real key: ${key}`);
    }

    try {
      const stringValue = JSON.stringify(value);
      await this.kv.put(key, stringValue);

      // Invalidate cache for this specific key to force fresh fetch on next read
      // This ensures immediate consistency after an update
      this.cache.delete(key);
      console.log(`Set KV: ${key} = ${value} (cache invalidated for this key)`);
      return true;
    } catch (error) {
      console.log(`Error setting key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete key
   */
  async delete(key) {
    if (!key || typeof key !== 'string') {
      console.log(`Invalid key: ${key}`);
      return false;
    }

    // Check if the key has a prefix
    if (!key.startsWith(CLOUDFLARE_KV_PREFIX)) {
      key = this.realKey(key);
      console.log(`Key without prefix, using real key: ${key}`);
    }

    try {
      await this.kv.delete(key);
      this.cache.delete(key);
      console.log(`Deleted KV: ${key}`);
      return true;
    } catch (error) {
      console.log(`Error deleting key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all
   */
  async getAll() {
    try {
      const list = await this.kv.list({
        prefix: CLOUDFLARE_KV_PREFIX,
        limit: 1000 // Limit to prevent overload
      });
      if (!list.keys || list.keys.length === 0) {
        console.log('No KV keys found');
        return {};
      }

      const configs = {};

      for (const item of list.keys) {
        const value = await this.get(item.name, null, false);
        // Strip prefix from key name for consistent object keys
        const keyWithoutPrefix = item.name.replace(`${CLOUDFLARE_KV_PREFIX}:`, '');
        configs[keyWithoutPrefix] = value;
      }

      console.log(`Retrieved all KV keys: ${Object.keys(configs).length} items`);
      return configs;
    } catch (error) {
      console.log(`Error getting all KV keys: ${error.message}`);
      return {};
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Cache cleared');
  }

  /**
   * Invalidate cache for specific keys
   * @param {string|Array<string>} keys - Key(s) to invalidate
   */
  invalidateCacheKeys(keys) {
    if (!Array.isArray(keys)) {
      keys = [keys];
    }
    
    keys.forEach(key => {
      // Handle keys with and without prefix
      let cacheKey = key;
      if (!key.startsWith(CLOUDFLARE_KV_PREFIX)) {
        cacheKey = this.realKey(key);
      }
      
      if (this.cache.has(cacheKey)) {
        this.cache.delete(cacheKey);
        console.log(`Invalidated cache for key: ${cacheKey}`);
      }
    });
  }

  /**
   * Parse value from string - Optimized version
   * Handles type conversion with better performance and cleaner logic
   */
  parseValue(value) {
    console.log(`parseValue input: ${JSON.stringify(value)} (type: ${typeof value})`);

    // Early return for non-string values
    if (typeof value !== 'string') {
      return value;
    }

    // Cache trimmed value to avoid multiple trim() calls
    const trimmedValue = value.trim();

    // Handle empty strings
    if (trimmedValue === '') {
      // console.log('parseValue returning empty string');
      return '';
    }

    // Handle special literal values first (most common cases)
    const specialValues = {
      'true': true,
      'false': false,
      'null': null,
      'undefined': undefined
    };

    if (trimmedValue in specialValues) {
      const result = specialValues[trimmedValue];
      // console.log(`parseValue special value: ${trimmedValue} -> ${result}`);
      return result;
    }

    // Try number conversion before JSON parsing (more efficient for numbers)
    if (this._isNumericString(trimmedValue)) {
      const num = Number(trimmedValue);
      if (isFinite(num)) {
        // console.log(`parseValue number converted: ${num} (type: ${typeof num})`);
        return num;
      }
    }

    // Try JSON parsing for complex values (objects, arrays, quoted strings)
    try {
      const parsed = JSON.parse(value); // Use original value for JSON parse
      // console.log(`parseValue JSON parsed: ${JSON.stringify(parsed)} (type: ${typeof parsed})`);

      // If JSON parsed to a different string, apply the same parsing logic
      if (typeof parsed === 'string' && parsed !== value) {
        return this.parseValue(parsed);
      }

      return parsed;
    } catch {
      // JSON parse failed, return trimmed original string
      // console.log(`parseValue returning original string: ${trimmedValue}`);
      return trimmedValue;
    }
  }

  /**
   * Helper method to check if a string represents a valid number
   * @private
   */
  _isNumericString(str) {
    // Handle edge cases
    if (str === '' || str === '.' || str === '-' || str === '+') {
      return false;
    }

    // Use parseFloat and Number for validation
    const num = parseFloat(str);
    return !isNaN(num) && isFinite(num) && str === num.toString();
  }

  /**
   * Get real key with prefix
  */
  realKey(key) {
    return `${CLOUDFLARE_KV_PREFIX}:${key}`;
  }

  /**
   * Get KV value with circuit breaker pattern
   * @param {string} key - KV key
   * @param {*} defaultValue - Default value if operation fails
   * @returns {Promise<*>} KV value or default
   */
  async getWithCircuitBreaker(key, defaultValue) {
    const maxRetries = 3;
    const baseDelay = 100; // 100ms

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`KV get attempt ${attempt}/${maxRetries} for key: ${key}`);
        const value = await this.kv.get(key);
        return value; // Success, return the value
      } catch (error) {
        console.log(`KV get attempt ${attempt} failed: ${error.message}`);

        if (attempt === maxRetries) {
          console.log(`All KV get attempts failed for key: ${key}, using circuit breaker fallback`);
          return defaultValue; // Circuit breaker: return default after all retries
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Waiting ${delay}ms before retry ${attempt + 1}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // ==========================================================================
  // RAW KV ACCESS METHODS
  // ==========================================================================

  /**
   * Get raw value from KV without prefixing or internal caching
   * @param {string} key - The exact key to get
   * @param {string} type - 'text', 'json', 'arrayBuffer', 'stream'
   */
  async getRaw(key, type = 'text') {
    return await this.kv.get(key, type);
  }

  /**
   * Get raw value with metadata from KV
   * @param {string} key - The exact key to get
   * @param {string} type - 'text', 'json', 'arrayBuffer', 'stream'
   */
  async getWithMetadataRaw(key, type = 'text') {
    return await this.kv.getWithMetadata(key, type);
  }

  /**
   * Put raw value into KV without prefixing
   * @param {string} key - The exact key to set
   * @param {string|ReadableStream|ArrayBuffer} value - The value to store
   * @param {Object} options - KV options (expiration, expirationTtl, metadata)
   */
  async putRaw(key, value, options = {}) {
    return await this.kv.put(key, value, options);
  }

  /**
   * Delete raw key from KV without prefixing
   * @param {string} key - The exact key to delete
   */
  async deleteRaw(key) {
    return await this.kv.delete(key);
  }

  /**
   * List keys from KV without forced prefix
   * @param {Object} options - List options (prefix, limit, cursor)
   */
  async listRaw(options = {}) {
    return await this.kv.list(options);
  }

  /**
   * Helper method to get boolean KV values
   * @param {string} key - KV key
   * @returns {Promise<boolean>} Boolean value
   */
  async getBooleanConfig(key) {
    const value = await this.getAuditConfig(key);
    if (typeof value === 'boolean') {return value;}
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return Boolean(value);
  }

  /**
   * Helper method to get numeric KV values
   * @param {string} key - KV key
   * @returns {Promise<number>} Numeric value
   */
  async getNumericConfig(key) {
    const value = await this.getAuditConfig(key);
    return typeof value === 'number' ? value : parseInt(value, 10) || 0;
  }
}
