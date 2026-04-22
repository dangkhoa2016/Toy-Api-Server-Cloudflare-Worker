# Comparison: Toy-Api-Server-Cloudflare-Worker vs Toy-Api-Server-Nodejs

> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](comparison-with-nodejs.vi.md)

> **Source of truth for logic:**
> [`github.com/dangkhoa2016/Toy-Api-Server-Nodejs`](https://github.com/dangkhoa2016/Toy-Api-Server-Nodejs)

> **Target runtime / port:**
> [`github.com/dangkhoa2016/Toy-Api-Server-Cloudflare-Worker`](https://github.com/dangkhoa2016/Toy-Api-Server-Cloudflare-Worker)

---

## Overview

`Toy-Api-Server-Cloudflare-Worker` is a **direct port** of `Toy-Api-Server-Nodejs`.
Both projects share the same naming conventions, business logic, error shape, and policy constants.
Differences are driven by runtime constraints (Fastify → Fetch API, CJS → ESM, in-memory → Cloudflare KV) and additional features required for correct operation in a distributed environment.

---

## 1. Directory structure

| Node.js (`app/`) | Cloudflare Worker (`src/`) | Role |
|---|---|---|
| `index.js` | `index.js` | Entry point, bootstrap |
| `libs/variables.js` | `lib/variables.js` | Constants, policy defaults |
| `libs/cors.js` | `lib/cors.js` | CORS helpers |
| `libs/http.js` | `lib/http.js` | Error payload builder |
| `libs/request_client.js` | `lib/request_client.js` | Client IP extraction |
| `middleware/basic_auth.js` | `lib/auth.js` | Basic Auth middleware |
| `middleware/rate_limit.js` | _(inlined in `index.js`)_ | Per-IP rate limiting |
| `routes/home.js` | `routes/home.js` | System routes (`/`, `/health`, `/docs`) |
| `routes/errors.js` | `routes/errors.js` | `404` / `500` handlers |
| `routes/toys.js` | `routes/toys.js` | Toy CRUD routes |
| `services/toys_service.js` | `services/toys_service.js` | Domain / business logic |
| `stores/memory_store.js` | `stores/kv_toy_store.js` | Toy data access |
| _(none)_ | `stores/kv_state_store.js` | Rate-limit & seed state (KV) |

> **Note:** The Worker renames `libs/` → `lib/` for brevity; all other filenames are identical.

---

## 2. Business logic — identical

### `toys_service.js`

Validation functions are **copied as-is**:

| Function | Behavior |
|---|---|
| `normalizeId(id)` | `Number(id)`, check `Number.isInteger` |
| `validateName(name)` | trim, min 2 / max 120 chars, same error messages |
| `validateImage(image)` | `new URL()`, check `http:` / `https:` protocol |
| `validateLikes(likes)` | `Number.isInteger && >= 0` |
| `createToy`, `saveToy`, `deleteToy`, `likeToy` | Same flow; Worker adds quota/seed/global-cap gates |

### `variables.js` — same policy defaults

```js
toyPolicyFallbacks = {
  cleanupIntervalMinutes: 1,
  maxToysPerIp:           5,
  rateLimitWindowMinutes: 5,
  seedMaxToysPerIp:       15,
  seedWindowMinutes:      10,
  toyTtlMinutes:          15,
}
```

---

## 3. Shared libs — direct port

### `cors.js`

| Symbol | Identical |
|---|---|
| `corsAllowedHeaders` | ✅ 100% |
| `corsExposedHeaders` | ✅ 100% |
| `corsMethods` | ✅ 100% |
| `parseCorsOrigins()` | ✅ 100% |
| `isLoopbackHostname()` | ✅ 100% |
| `isLoopbackOrigin()` | ✅ 100% |
| `parseUrl()` | ✅ 100% |

### `http.js`

`errorPayload()` is 100% identical — same response shape:

```json
{
  "error": {
    "statusCode": 422,
    "message": "...",
    "details": {}
  }
}
```

### `request_client.js`

- Same core logic: `x-forwarded-for → split(',')[0].trim()`
- Worker additionally reads `cf-connecting-ip` and `x-real-ip` (Cloudflare network specifics)

### `auth.js` / `middleware/basic_auth.js`

- `decodeCredentials()` — same algorithm (Base64 decode, find `:` separator)
- `safeEqual()` — same constant-time comparison intent
  - Node.js: `Buffer` + `crypto.timingSafeEqual`
  - Worker: plain XOR loop (runtime lacks `node:crypto`)
- `credentialsMatch()` — identical

---

## 4. Routes — same endpoint set, same response contract

### System routes

| Endpoint | Node.js | Worker |
|---|---|---|
| `GET /` | ✅ | ✅ |
| `GET /healthz` | ✅ | ✅ (as `/health`) |
| `GET /docs` | ✅ | ✅ |
| `GET /openapi.json` | ✅ | ✅ |
| `GET /404` | ✅ | ✅ |
| `GET /500` | ✅ | ✅ |
| `GET /favicon.ico` | ✅ | ✅ |
| `GET /favicon.png` | ✅ | ✅ |

### Toy routes

| Endpoint | Node.js | Worker |
|---|---|---|
| `GET /api/toys` | ✅ | ✅ |
| `GET /api/toys/export` | ✅ | ✅ |
| `POST /api/toys` | ✅ | ✅ |
| `GET /api/toys/:id` | ✅ | ✅ |
| `PATCH\|PUT\|POST /api/toys/:id` | ✅ | ✅ |
| `PATCH\|PUT\|POST /api/toys/:id/likes` | ✅ | ✅ |
| `DELETE /api/toys/:id` | ✅ | ✅ |

---

## 5. Key differences (runtime constraints)

| Aspect | Node.js | Cloudflare Worker |
|---|---|---|
| **Framework** | Fastify (plugins, hooks, JSON schema validation) | Plain Fetch API (Request/Response) |
| **Module system** | CommonJS (`require / module.exports`) | ESM (`import / export`) |
| **Routing** | `fastify.get()`, `fastify.register()` | Manual regex pattern matching |
| **Storage — toys** | In-memory `MemoryStore` (single process) | Cloudflare KV (`kv_toy_store.js`) |
| **Storage — state** | `MemoryStore.rateLimits` / `seedStates` (Map) | `KvStateStore` (KV, persistent, with TTL) |
| **ID generation** | Sequential integer (`nextId++`) | Collision-resistant random safe integer (`crypto.getRandomValues`) |
| **Global toy cap** | Not present | Present (`maxActiveToysGlobal`) |
| **Toy TTL** | Manual expiry check in memory | KV native TTL (`expirationTtl`) |
| **Crypto** | `node:crypto` (`timingSafeEqual`, `randomUUID`) | Web Crypto API (`crypto.getRandomValues`, `atob`) |
| **Static assets** | Inline buffer from `libs/branding.js` | Cloudflare Assets binding (`ASSETS.fetch`) |

---

## 6. KV TTL vs in-memory expiry

Node.js stores `expires_at` in the object and checks it manually on every read.
The Worker leverages KV native TTL — keys are deleted automatically after expiry — while still storing `expires_at` in the payload for API parity.

| Key prefix | KV TTL | Node.js equivalent |
|---|---|---|
| `…:toy:<id>` | 900 s (15 min) | `toy.expires_at` (15 min) |
| `…:ratelimit:<ip>` | 360 s (6 min) | `MemoryStore.rateLimits` — no automatic TTL |
| `…:seed:<ip>` | 1680 s (28 min) | `MemoryStore.seedStates` — no automatic TTL |

---

## 7. Worker-only features (not in Node.js)

- **Global active toy cap** (`maxActiveToysGlobal`): hard limit on total active toys across all clients.
- **Collision-resistant ID allocation**: loops up to 12 times, checking the KV key before writing.
- **KV-backed rate-limit & seed state**: state survives restarts and is shared across isolates.
- **Explicit CORS preflight handling** at the entry layer (`src/index.js`).
- **`x-request-id` / `x-correlation-id`** headers injected into every response.
- **Security headers** (`X-Content-Type-Options`, `X-Frame-Options`, etc.) toggled via `SECURITY_HEADERS_ENABLED`.
