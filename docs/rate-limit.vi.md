# Chính sách chống lạm dụng & Rate Limiting

> 🌐 **Language / Ngôn ngữ:** [English](rate-limit.md) | Tiếng Việt

`POST /api/toys` được bảo vệ bởi hai lớp kiểm soát độc lập để ngăn chặn lạm dụng.

---

## Lớp 1 — HTTP Rate Limit (đếm số lần gọi)

**Áp dụng:** Chỉ `POST /api/toys`, theo IP của client.

**Cơ chế** (hàm `applyRateLimitIfNeeded` trong `src/index.js`):

- Mỗi request `POST /api/toys` tăng counter lên 1, lưu trong KV key `…:ratelimit:<ip>`.
- Nếu `count > RATE_LIMIT_MAX` trong cùng một window → **`429 Too Many Requests`**.
- Window reset sau `RATE_LIMIT_WINDOW_MS` milliseconds.

| Tham số | Mặc định | Override bằng |
|---|---|---|
| Bật/tắt | `true` (tắt khi `NODE_ENV=test`) | `RATE_LIMIT_ENABLED` |
| Số request tối đa/window | **20** | `RATE_LIMIT_MAX` |
| Độ dài window | **5 phút** (300.000 ms) | `RATE_LIMIT_WINDOW_MS` |

**Response headers** đính kèm vào mọi request đi qua lớp này:

```
x-ratelimit-limit:     20
x-ratelimit-remaining: 17
x-ratelimit-reset:     <unix timestamp tính bằng giây>
retry-after:           <giây>   ← chỉ khi bị chặn (429)
```

**Paths bỏ qua** (không áp dụng rate limit dù method nào):

- `/health`
- `/favicon.ico`
- `/favicon.png`

---

## Lớp 2 — Toy Quota (đếm số toy đang active)

**Áp dụng:** Bên trong `createToy()` ở `src/services/toys_service.js`, sau khi qua Lớp 1.

Ba gate được kiểm tra theo thứ tự:

### Gate A — Global cap

- Đếm tổng tất cả toy active trong toàn service (mọi IP).
- Nếu `activeGlobalToyCount >= MAX_ACTIVE_TOYS_GLOBAL` → **`429`** với `scope: 'global'`.

| Tham số | Mặc định | Override bằng |
|---|---|---|
| Giới hạn toàn cục | **500** | `MAX_ACTIVE_TOYS_GLOBAL` |

### Gate B — Per-IP quota (bình thường)

- Đếm số toy active của IP đang request.
- Nếu `activeToyCount >= maxToysPerIp` → **`429`** kèm thông tin chi tiết.

| Tham số | Mặc định | Override bằng |
|---|---|---|
| Quota toy mỗi IP | **5** | `MAX_TOYS_PER_IP` |
| Thời gian sống của toy | **15 phút** | `TOY_TTL_MS` |

### Gate C — Seed mode (mở rộng quota tạm thời)

- Khi một IP **tạo toy lần đầu tiên**, seed window được kích hoạt.
- Trong seed window: quota được nâng lên `SEED_MAX_TOYS_PER_IP`.
- Sau khi seed window hết hạn: quota quay về `MAX_TOYS_PER_IP` bình thường.
- Trạng thái seed được lưu trong KV key `…:seed:<ip>`.

| Tham số | Mặc định | Override bằng |
|---|---|---|
| Thời lượng seed window | **10 phút** | `SEED_WINDOW_MS` |
| Quota mở rộng | **15 toy** | `SEED_MAX_TOYS_PER_IP` |

---

## Ví dụ tổng hợp (cấu hình mặc định)

```
IP 1.2.3.4 bắt đầu gửi POST /api/toys:

Request 1-15:  → 201 Created   (seed window mở, quota = 15)
Request 16:    → 429 Toy quota exceeded (seedMode: true, limit: 15)

── Sau 10 phút (seed window hết) ──
(vẫn còn 5 toy active, chưa hết TTL)
Request tiếp:  → 429 Toy quota exceeded (limit: 5)

── Sau 15 phút (toy hết TTL, active count = 0) ──
Request tiếp:  → 201 Created   (quota bình thường = 5 phục hồi)

── Kiểm tra lớp rate limit ──
Nếu cùng IP gửi 20 request POST trong vòng 5 phút (kế quả lớp 2 không quan trọng):
Request thứ 21: → 429 (HTTP rate limit, kèm header retry-after)
```

---

## Tính độc lập của 2 lớp

- **Lớp 1** đếm **số lần gọi API**, kể cả những request đã bị từ chối bởi Lớp 2.
- **Lớp 2** đếm **số toy đang sống trong KV** — tự giảm khi toy hết TTL.
- Bị chặn bởi Lớp 1 không ảnh hưởng đến counter của Lớp 2, và ngược lại.

---

## Tham chiếu cấu hình

Tất cả tham số có thể cài trong `.dev.vars` (local) hoặc `.env.staging` / `.env.production` (deploy):

| Biến | Lớp | Mặc định | Mục đích |
|---|---|---|---|
| `RATE_LIMIT_ENABLED` | 1 | `true` | Bật/tắt HTTP rate limiting |
| `RATE_LIMIT_MAX` | 1 | `20` | Số request tối đa mỗi window mỗi IP |
| `RATE_LIMIT_WINDOW_MS` | 1 | `300000` | Độ dài window tính bằng ms (5 phút) |
| `MAX_ACTIVE_TOYS_GLOBAL` | 2-A | `500` | Giới hạn toy active toàn cục |
| `MAX_TOYS_PER_IP` | 2-B | `5` | Quota toy mặc định mỗi IP |
| `TOY_TTL_MS` | 2-B/C | `900000` | Thời gian sống của mỗi toy (15 phút) |
| `SEED_WINDOW_MS` | 2-C | `600000` | Thời lượng seed window (10 phút) |
| `SEED_MAX_TOYS_PER_IP` | 2-C | `15` | Quota mở rộng trong seed window |

Xem thêm: [KV Key TTL](kv-ttl.md) để biết các giá trị này ánh xạ tới thời gian hết hạn KV như thế nào.
