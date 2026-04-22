# So sánh: Toy-Api-Server-Cloudflare-Worker vs Toy-Api-Server-Nodejs

> 🌐 Language / Ngôn ngữ: [English](comparison-with-nodejs.md) | **Tiếng Việt**

> **Nguồn tham chiếu cho logic:**
> [`github.com/dangkhoa2016/Toy-Api-Server-Nodejs`](https://github.com/dangkhoa2016/Toy-Api-Server-Nodejs)

> **Runtime đích / bản port:**
> [`github.com/dangkhoa2016/Toy-Api-Server-Cloudflare-Worker`](https://github.com/dangkhoa2016/Toy-Api-Server-Cloudflare-Worker)

---

## Tổng quan

`Toy-Api-Server-Cloudflare-Worker` là bản **port trực tiếp** từ `Toy-Api-Server-Nodejs`.
Hai dự án giữ nguyên naming conventions, business logic, error shape, và policy constants.
Sự khác biệt chủ yếu đến từ runtime constraint (Fastify → Fetch API, CJS → ESM, in-memory → Cloudflare KV) và các tính năng bổ sung để hoạt động đúng trong môi trường phân tán (distributed).

---

## 1. Cấu trúc thư mục

| Node.js (`app/`) | Cloudflare Worker (`src/`) | Vai trò |
|---|---|---|
| `index.js` | `index.js` | Entry point, bootstrap |
| `libs/variables.js` | `lib/variables.js` | Constants, policy defaults |
| `libs/cors.js` | `lib/cors.js` | CORS helpers |
| `libs/http.js` | `lib/http.js` | Error payload builder |
| `libs/request_client.js` | `lib/request_client.js` | Client IP extraction |
| `middleware/basic_auth.js` | `lib/auth.js` | Basic Auth middleware |
| `middleware/rate_limit.js` | _(inline trong `index.js`)_ | Rate limiting per-IP |
| `routes/home.js` | `routes/home.js` | System routes (`/`, `/health`, `/docs`) |
| `routes/errors.js` | `routes/errors.js` | `404` / `500` handlers |
| `routes/toys.js` | `routes/toys.js` | Toy CRUD routes |
| `services/toys_service.js` | `services/toys_service.js` | Domain / business logic |
| `stores/memory_store.js` | `stores/kv_toy_store.js` | Toy data access |
| _(không có)_ | `stores/kv_state_store.js` | Rate-limit & seed state (KV) |

> **Nhận xét:** Worker đổi `libs/` → `lib/` để ngắn gọn hơn; mọi tên file khác giữ nguyên.

---

## 2. Business logic — giống nhau

### `toys_service.js`

Các hàm validate được **copy-paste** và giữ nguyên hoàn toàn:

| Hàm | Behavior |
|---|---|
| `normalizeId(id)` | `Number(id)`, check `Number.isInteger` |
| `validateName(name)` | trim, min 2 / max 120 ký tự, cùng error message |
| `validateImage(image)` | `new URL()`, check `http:` / `https:` protocol |
| `validateLikes(likes)` | `Number.isInteger && >= 0` |
| `createToy`, `saveToy`, `deleteToy`, `likeToy` | Cùng flow; Worker thêm gate quota/seed/global cap |

### `variables.js` — policy defaults giống nhau

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

## 3. Shared libs — port trực tiếp

### `cors.js`

| Symbol | Giống nhau |
|---|---|
| `corsAllowedHeaders` | ✅ 100% |
| `corsExposedHeaders` | ✅ 100% |
| `corsMethods` | ✅ 100% |
| `parseCorsOrigins()` | ✅ 100% |
| `isLoopbackHostname()` | ✅ 100% |
| `isLoopbackOrigin()` | ✅ 100% |
| `parseUrl()` | ✅ 100% |

### `http.js`

`errorPayload()` giống 100% — cùng response shape:

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

- Cùng logic: `x-forwarded-for → split(',')[0].trim()`
- Worker bổ sung thêm `cf-connecting-ip`, `x-real-ip` (đặc thù Cloudflare network)

### `auth.js` / `middleware/basic_auth.js`

- `decodeCredentials()` — cùng algorithm (Base64 decode, tìm `:` separator)
- `safeEqual()` — cùng ý định constant-time compare
  - Node.js: `Buffer` + `crypto.timingSafeEqual`
  - Worker: XOR loop thuần (runtime không có `node:crypto`)
- `credentialsMatch()` — giống nhau

---

## 4. Routes — cùng endpoint set, cùng response contract

### System routes

| Endpoint | Node.js | Worker |
|---|---|---|
| `GET /` | ✅ | ✅ |
| `GET /healthz` | ✅ | ✅ (`/health`) |
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

## 5. Điểm khác biệt chính (do runtime constraint)

| Khía cạnh | Node.js | Cloudflare Worker |
|---|---|---|
| **Framework** | Fastify (plugin, hook, JSON schema validation) | Fetch API thuần (Request/Response) |
| **Module system** | CommonJS (`require / module.exports`) | ESM (`import / export`) |
| **Routing** | `fastify.get()`, `fastify.register()` | Manual regex pattern matching |
| **Storage — toys** | In-memory `MemoryStore` (single process) | Cloudflare KV (`kv_toy_store.js`) |
| **Storage — state** | `MemoryStore.rateLimits` / `seedStates` (Map) | `KvStateStore` (KV, persistent, có TTL) |
| **ID generation** | Sequential integer (`nextId++`) | Collision-resistant random safe integer (`crypto.getRandomValues`) |
| **Global toy cap** | Không có | Có (`maxActiveToysGlobal`) |
| **Toy TTL** | In-memory expiry check | KV native TTL (`expirationTtl`) |
| **Crypto** | `node:crypto` (`timingSafeEqual`, `randomUUID`) | Web Crypto API (`crypto.getRandomValues`, `atob`) |
| **Static assets** | Inline buffer từ `libs/branding.js` | Cloudflare Assets binding (`ASSETS.fetch`) |

---

## 6. KV TTL so với in-memory expiry

Node.js dùng `expires_at` field trong object, kiểm tra thủ công khi đọc.
Worker tận dụng KV native TTL — key tự xóa sau khi hết hạn — đồng thời vẫn giữ `expires_at` field trong payload cho parity.

| Key prefix | KV TTL | Tương đương Node.js |
|---|---|---|
| `…:toy:<id>` | 900 s (15 phút) | `toy.expires_at` (15 phút) |
| `…:ratelimit:<ip>` | 360 s (6 phút) | `MemoryStore.rateLimits` — không có TTL tự động |
| `…:seed:<ip>` | 1680 s (28 phút) | `MemoryStore.seedStates` — không có TTL tự động |

---

## 7. Tính năng Worker-only (không có trong Node.js)

- **Global active toy cap** (`maxActiveToysGlobal`): giới hạn tổng toy active toàn cục.
- **Collision-resistant ID allocation**: loop tối đa 12 lần, mỗi lần kiểm tra key KV trước khi ghi.
- **KV-backed rate-limit & seed state**: state tồn tại qua restart và đồng bộ giữa các isolate.
- **CORS preflight xử lý riêng** tại tầng entry (`src/index.js`).
- **`x-request-id` / `x-correlation-id`** headers được inject vào mọi response.
- **Security headers** (`X-Content-Type-Options`, `X-Frame-Options`, v.v.) bật qua `SECURITY_HEADERS_ENABLED`.
