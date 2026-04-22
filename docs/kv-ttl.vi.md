# KV Key TTL

> 🌐 Language / Ngôn ngữ: [English](kv-ttl.md) | **Tiếng Việt**

Mỗi loại key trong Cloudflare KV có TTL (thời gian hết hạn) khác nhau, được tính từ giá trị mặc định của policy cộng thêm một khoảng buffer:

| Prefix | KV TTL | Cách tính | Ý nghĩa thực tế |
| --- | --- | --- | --- |
| `…:toy:<id>` | **900 s (15 phút)** | `toyTtlMs` (mặc định 15 phút) | Toy tồn tại đúng bằng `TOY_TTL_MS` |
| `…:ratelimit:<clientKey>` | **360 s (6 phút)** | `ceil(rateLimitWindowMs / 1000) + 60 s buffer` | Cửa sổ rate-limit là 5 phút; key giữ thêm 1 phút sau khi window reset |
| `…:seed:<clientKey>` | **1680 s (28 phút)** | `ceil((seedWindowMs + toyTtlMs) / 1000) + 180 s buffer` | Cửa sổ seed là 10 phút; key được giữ đủ lâu để toy được tạo cuối window vẫn có thể hết hạn (10 + 15 + 3 phút buffer) |

## Giải thích chi tiết

### `:toy:<id>` — 900 giây (15 phút)

- TTL KV bằng đúng `TOY_TTL_MS`.
- Khi key hết hạn, toy tự động biến mất khỏi KV mà không cần cleanup thủ công.
- `expires_at` vẫn được lưu trong payload để đồng bộ với Node.js API.

### `:ratelimit:<clientKey>` — 360 giây (6 phút)

- Cửa sổ rate-limit thực sự là **5 phút** (`rateLimitWindowMs = 300_000 ms`).
- Key KV sống thêm **60 giây buffer** sau khi window kết thúc để tránh race condition tại thời điểm reset.
- Công thức: `normalizeTtlSeconds(windowMs, 60)` trong `src/stores/kv_state_store.js`.

### `:seed:<clientKey>` — 1680 giây (28 phút)

- Cửa sổ seed thực sự là **10 phút** (`seedWindowMs = 600_000 ms`).
- Key được giữ thêm `toyTtlMs` (15 phút) để vẫn hợp lệ khi toy được tạo gần cuối window chưa hết TTL.
- Cộng thêm **180 giây buffer** để an toàn.
- Công thức: `normalizeTtlSeconds(seedWindowMs + toyTtlMs, 180)` trong `src/stores/kv_state_store.js`.

## Cấu hình liên quan

Giá trị mặc định được khai báo trong `src/lib/variables.js` (`toyPolicyFallbacks`):

```js
toyPolicyFallbacks = {
  toyTtlMinutes:          15,  // → :toy: TTL = 900 s
  rateLimitWindowMinutes:  5,  // → :ratelimit: TTL = 360 s
  seedWindowMinutes:      10,  // → :seed: TTL = 1680 s
}
```

Logic tính buffer TTL nằm trong `src/stores/kv_state_store.js`:

```js
function normalizeTtlSeconds(windowMs, additionalSeconds = 60) {
  const seconds = Math.ceil(Number(windowMs) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 120;
  return Math.max(60, seconds + additionalSeconds);
}
```

Có thể override tất cả qua biến môi trường trong `.dev.vars` / `.env.staging` / `.env.production`:

| Biến | Ảnh hưởng tới |
| --- | --- |
| `TOY_TTL_MS` | TTL của `:toy:` key |
| `RATE_LIMIT_WINDOW_MS` | TTL của `:ratelimit:` key |
| `SEED_WINDOW_MS` | TTL của `:seed:` key |
