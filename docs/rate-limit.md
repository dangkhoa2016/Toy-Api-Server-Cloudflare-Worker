# Anti-abuse Policy & Rate Limiting

> 🌐 **Language / Ngôn ngữ:** English | [Tiếng Việt](rate-limit.vi.md)

`POST /api/toys` is protected by two independent control layers to prevent abuse.

---

## Layer 1 — HTTP Rate Limit (request counter)

**Applies to:** `POST /api/toys` only, per client IP.

**How it works** (`applyRateLimitIfNeeded` in `src/index.js`):

- Every `POST /api/toys` request increments a counter stored in the KV key `…:ratelimit:<ip>`.
- If `count > RATE_LIMIT_MAX` within the current window → **`429 Too Many Requests`**.
- The window resets after `RATE_LIMIT_WINDOW_MS` milliseconds.

| Parameter | Default | Override via |
|---|---|---|
| Enabled | `true` (disabled in `NODE_ENV=test`) | `RATE_LIMIT_ENABLED` |
| Max requests per window | **20** | `RATE_LIMIT_MAX` |
| Window length | **5 minutes** (300,000 ms) | `RATE_LIMIT_WINDOW_MS` |

**Response headers** attached to every request that passes through this layer:

```
x-ratelimit-limit:     20
x-ratelimit-remaining: 17
x-ratelimit-reset:     <unix timestamp seconds>
retry-after:           <seconds>   ← only when blocked (429)
```

**Skipped paths** (not subject to rate limiting regardless of method):

- `/health`
- `/favicon.ico`
- `/favicon.png`

---

## Layer 2 — Toy Quota (active toy counter)

**Applies to:** Inside `createToy()` in `src/services/toys_service.js`, evaluated after Layer 1.

Three gates are checked in order:

### Gate A — Global cap

- Counts all active toys across **all clients** in the service.
- If `activeGlobalToyCount >= MAX_ACTIVE_TOYS_GLOBAL` → **`429`** with `scope: 'global'`.

| Parameter | Default | Override via |
|---|---|---|
| Global cap | **500** | `MAX_ACTIVE_TOYS_GLOBAL` |

### Gate B — Per-IP quota (default)

- Counts active toys for the requesting IP.
- If `activeToyCount >= maxToysPerIp` → **`429`** with `scope` per-IP details.

| Parameter | Default | Override via |
|---|---|---|
| Per-IP toy limit | **5** | `MAX_TOYS_PER_IP` |
| Toy TTL | **15 minutes** | `TOY_TTL_MS` |

### Gate C — Seed mode (temporary quota expansion)

- When an IP **creates its first toy ever**, a seed window opens.
- During the seed window: quota is raised to `SEED_MAX_TOYS_PER_IP`.
- After the seed window expires: quota returns to the normal `MAX_TOYS_PER_IP`.
- Seed state is tracked in KV key `…:seed:<ip>`.

| Parameter | Default | Override via |
|---|---|---|
| Seed window duration | **10 minutes** | `SEED_WINDOW_MS` |
| Expanded quota | **15 toys** | `SEED_MAX_TOYS_PER_IP` |

---

## Combined example (default config)

```
IP 1.2.3.4 starts sending POST /api/toys:

Requests 1–15:  → 201 Created   (seed window active, quota = 15)
Request 16:     → 429 Toy quota exceeded (seedMode: true, limit: 15)

── After 10 min (seed window expires) ──
(5 toys still active, TTL not yet elapsed)
Next request:   → 429 Toy quota exceeded (limit: 5)

── After 15 min (toys expire, active count = 0) ──
Next request:   → 201 Created   (normal quota = 5 resumes)

── Rate limit layer check ──
If the same IP sends 20 POST requests within 5 min (regardless of Layer 2 result):
Request 21:     → 429 (HTTP rate limit, retry-after header set)
```

---

## Key independence

- **Layer 1** counts **API calls**, including calls already rejected by Layer 2.
- **Layer 2** counts **live toys in KV** — decrements automatically as toys reach their TTL.
- Being blocked by Layer 1 does not affect Layer 2 counters, and vice versa.

---

## Configuration reference

All parameters can be set in `.dev.vars` (local) or `.env.staging` / `.env.production` (deploy-time):

| Variable | Layer | Default | Purpose |
|---|---|---|---|
| `RATE_LIMIT_ENABLED` | 1 | `true` | Enable/disable HTTP rate limiting |
| `RATE_LIMIT_MAX` | 1 | `20` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | 1 | `300000` | Rate-limit window in ms (5 min) |
| `MAX_ACTIVE_TOYS_GLOBAL` | 2-A | `500` | Global active toy cap |
| `MAX_TOYS_PER_IP` | 2-B | `5` | Default per-IP toy quota |
| `TOY_TTL_MS` | 2-B/C | `900000` | How long each toy lives (15 min) |
| `SEED_WINDOW_MS` | 2-C | `600000` | Seed window duration (10 min) |
| `SEED_MAX_TOYS_PER_IP` | 2-C | `15` | Expanded quota during seed window |

See also: [KV Key TTL](kv-ttl.en.md) for how these values map to KV expiration times.
