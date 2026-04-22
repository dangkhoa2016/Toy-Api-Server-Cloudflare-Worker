# KV Key TTL

> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](kv-ttl.vi.md)

Each key type in Cloudflare KV has a different expiration TTL, calculated from the policy default value plus a buffer:

| Prefix | KV TTL | Calculation | Effective window / lifetime |
| --- | --- | --- | --- |
| `…:toy:<id>` | **900 s (15 min)** | `toyTtlMs` (default 15 min) | Toy lives exactly `TOY_TTL_MS` |
| `…:ratelimit:<clientKey>` | **360 s (6 min)** | `ceil(rateLimitWindowMs / 1000) + 60 s buffer` | Rate-limit window is 5 min; key kept 1 min after window reset |
| `…:seed:<clientKey>` | **1680 s (28 min)** | `ceil((seedWindowMs + toyTtlMs) / 1000) + 180 s buffer` | Seed window is 10 min; key kept long enough for a toy created at the end of the window to fully expire (10 + 15 + 3 min buffer) |

## Detailed explanation

### `:toy:<id>` — 900 seconds (15 minutes)

- KV TTL equals exactly `TOY_TTL_MS`.
- When the key expires, the toy disappears from KV automatically without manual cleanup.
- `expires_at` is still stored in the payload for parity with the Node.js API.

### `:ratelimit:<clientKey>` — 360 seconds (6 minutes)

- The actual rate-limit window is **5 minutes** (`rateLimitWindowMs = 300_000 ms`).
- The KV key lives an extra **60-second buffer** after the window ends to avoid race conditions at reset time.
- Formula: `normalizeTtlSeconds(windowMs, 60)` in `src/stores/kv_state_store.js`.

### `:seed:<clientKey>` — 1680 seconds (28 minutes)

- The actual seed window is **10 minutes** (`seedWindowMs = 600_000 ms`).
- The key is kept for an additional `toyTtlMs` (15 minutes) so it remains valid while a toy created near the end of the window hasn't expired yet.
- Plus an extra **180-second buffer** for safety.
- Formula: `normalizeTtlSeconds(seedWindowMs + toyTtlMs, 180)` in `src/stores/kv_state_store.js`.

## Related configuration

Default values are declared in `src/lib/variables.js` (`toyPolicyFallbacks`):

```js
toyPolicyFallbacks = {
  toyTtlMinutes:          15,  // → :toy: TTL = 900 s
  rateLimitWindowMinutes:  5,  // → :ratelimit: TTL = 360 s
  seedWindowMinutes:      10,  // → :seed: TTL = 1680 s
}
```

Buffer TTL calculation lives in `src/stores/kv_state_store.js`:

```js
function normalizeTtlSeconds(windowMs, additionalSeconds = 60) {
  const seconds = Math.ceil(Number(windowMs) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 120;
  return Math.max(60, seconds + additionalSeconds);
}
```

All values can be overridden via environment variables in `.dev.vars` / `.env.staging` / `.env.production`:

| Variable | Affects |
| --- | --- |
| `TOY_TTL_MS` | TTL of `:toy:` keys |
| `RATE_LIMIT_WINDOW_MS` | TTL of `:ratelimit:` keys |
| `SEED_WINDOW_MS` | TTL of `:seed:` keys |
