# Toy API Server - Cloudflare Worker

> 🌐 Language / Ngôn ngữ: [English](README.md) | **Tiếng Việt**

Phiên bản Cloudflare Worker được triển khai để di chuyển từ dự án [Toy-Api-Server-Nodejs](https://github.com/dangkhoa2016/Toy-Api-Server-Nodejs) dùng Fastify.

Repository này là bản port Cloudflare Worker bám theo business logic, naming conventions, và API behavior của repo Node.js gốc.

Để xem tài liệu đối chiếu theo từng nhóm file với phiên bản Node.js, xem [docs/comparison-with-nodejs.vi.md](docs/comparison-with-nodejs.vi.md).
([English](docs/comparison-with-nodejs.md))

## Tích hợp frontend

API này cũng được dùng làm backend cho các dự án frontend sau:

- [Toys-UI-Javascript](https://github.com/dangkhoa2016/Toys-UI-Javascript)
- [Toys-UI-VueJs](https://github.com/dangkhoa2016/Toys-UI-VueJs)

## Phạm vi hiện tại

- Khởi tạo dự án Worker với Wrangler.
- Chuyển các hằng số lõi và giá trị mặc định của policy.
- Chuyển các helper dùng chung: HTTP payload, nhận diện client key, CORS, basic auth, validation request.
- Đồng bộ cách đặt tên với dự án Node.js:
  - `src/lib/variables.js`
  - `src/lib/request_client.js`
  - `src/services/toys_service.js`
  - `src/stores/kv_state_store.js`
  - `src/stores/kv_toy_store.js`
- Tách và nhóm route để dễ đọc hơn:
  - `src/routes/home.js`
  - `src/routes/errors.js`
  - `src/routes/toys.js`
- Triển khai các system route:
  - `GET /`
  - `GET /health`
  - `GET /docs`
  - `GET /openapi.json`
  - `GET /404`
  - `GET /500`
  - `GET /favicon.ico`
  - `GET /favicon.png`
- Triển khai toy routes trên KV:
  - `GET /api/toys`
  - `GET /api/toys/export`
  - `POST /api/toys`
  - `GET /api/toys/:id`
  - `PATCH|PUT|POST /api/toys/:id`
  - `PATCH|PUT|POST /api/toys/:id/likes`
  - `DELETE /api/toys/:id`
- Bổ sung các cơ chế chống lạm dụng:
  - rate limit `POST /api/toys` theo IP
  - quota toy đang active theo IP với seed window mở rộng tạm thời
  - giới hạn tổng số toy đang active trên toàn hệ thống
  - TTL cho toy và cơ chế dọn dẹp theo lịch
- Phục vụ docs và icon thông qua static asset binding:
  - thư mục assets của Worker: `src/assets`
  - `/docs` phục vụ `src/assets/docs.html`
  - `/imgs/*`, `/favicon.ico`, `/favicon.png` được phục vụ qua `ASSETS`
- Giảm nguy cơ va chạm ID khi tạo đồng thời ở nhiều request và nhiều isolate:
  - `POST /api/toys` hiện dùng cơ chế cấp phát ID safe-integer chống va chạm trong `src/stores/kv_toy_store.js`
- Bổ sung response headers nhất quán (`x-request-id`, `x-correlation-id`) và xử lý CORS preflight.

## Tổng quan kiến trúc

- Điểm vào và pipeline xử lý request: `src/index.js`
- Shared libs: `src/lib/*.js`
- Các module route: `src/routes/*.js`
- Domain service: `src/services/toys_service.js`
- KV stores: `src/stores/*.js`
- Docs và icon tĩnh: `src/assets/**`

## Chính sách chống lạm dụng

`POST /api/toys` được bảo vệ bởi hai lớp độc lập:

- **Lớp 1 — HTTP rate limit:** tối đa 20 request trong mỗi cửa sổ 5 phút cho mỗi IP.
- **Lớp 2 — Toy quota:** giới hạn số toy active theo IP, giới hạn tổng số toy active toàn cục, và seed window mở rộng quota tạm thời.

Xem [docs/rate-limit.vi.md](docs/rate-limit.vi.md) để biết đầy đủ luồng xử lý, headers, ví dụ, và phần tham chiếu cấu hình.
([English](docs/rate-limit.md))

## Quy ước đặt tên KV key

Các entry trong Cloudflare KV của `TOY_STATE` dùng prefix để tách các miền dữ liệu:

| Prefix | Mục đích | Quản lý tại |
| --- | --- | --- |
| `<CLOUDFLARE_KV_PREFIX>:toy:<id>` | Payload của toy entity | `src/stores/kv_toy_store.js` |
| `<CLOUDFLARE_KV_PREFIX>:ratelimit:<clientKey>` | Trạng thái rate-limit tạo mới theo client (`count`, `resetAt`) | `src/stores/kv_state_store.js` |
| `<CLOUDFLARE_KV_PREFIX>:seed:<clientKey>` | Trạng thái seed-window theo client (`firstCreateAt`, `successfulCreates`) | `src/stores/kv_state_store.js` |

`CLOUDFLARE_KV_PREFIX` mặc định là `toy-api-server` nếu không được cấu hình rõ ràng.

`clientKey` được suy ra từ định danh của client trong request, thường là địa chỉ IP.

### TTL của KV key

Xem [docs/kv-ttl.md](docs/kv-ttl.md) để biết đầy đủ cách TTL được tách nhỏ, công thức tính và phần tham chiếu cấu hình.
([Tiếng Việt](docs/kv-ttl.vi.md))

## Phát triển cục bộ

1. Cài dependencies:

```bash
npm install
```

2. Đăng nhập Cloudflare nếu cần:

```bash
npx wrangler login
```

3. Tạo file env cục bộ:

```bash
cp .dev.vars.example .dev.vars
```

4. Chạy local:

```bash
npm run dev
```

`npm run dev` dùng `wrangler.template.toml` với `--env development`.

## Tham chiếu khóa cấu hình

### `.dev.vars` (runtime cục bộ)

| Key | Bắt buộc | Mục đích |
| --- | --- | --- |
| `NODE_ENV` | Có | Chế độ runtime cho local worker execution. |
| `CORS_ORIGINS` | Có | Danh sách origin được phép cho CORS. |
| `CLOUDFLARE_KV_PREFIX` | Không (khuyến nghị) | Prefix gắn trước mọi KV key để cô lập service này trong namespace dùng chung. |
| `SECURITY_HEADERS_ENABLED` | Không (khuyến nghị) | Bật security headers (`nosniff`, frame/referrer policy). |
| `APP_NAME` | Không | Nhãn ứng dụng cho log/debug context. |
| `BASIC_AUTH_ENABLED` | Không | Bật/tắt HTTP Basic Auth middleware. |
| `BASIC_AUTH_USERNAME` | Bắt buộc khi bật auth | Tên người dùng Basic Auth. |
| `BASIC_AUTH_PASSWORD` | Bắt buộc khi bật auth | Mật khẩu Basic Auth. |
| `BASIC_AUTH_REALM` | Không | Chuỗi realm hiển thị trong auth challenge. |
| `RATE_LIMIT_ENABLED` | Không (khuyến nghị) | Bật/tắt rate limiting cho `POST /api/toys` theo IP. |
| `RATE_LIMIT_MAX` | Không | Số lần tạo tối đa trong mỗi cửa sổ rate-limit. |
| `RATE_LIMIT_WINDOW_MS` | Không | Độ dài cửa sổ rate-limit tính bằng milliseconds. |
| `MAX_ACTIVE_TOYS_GLOBAL` | Không | Giới hạn tổng số toy active trên toàn bộ client. |
| `MAX_TOYS_PER_IP` | Không | Quota toy active mặc định cho mỗi IP. |
| `SEED_MAX_TOYS_PER_IP` | Không | Quota mở rộng cho mỗi IP trong seed window. |
| `SEED_WINDOW_MS` | Không | Thời lượng seed window tính bằng milliseconds. |
| `TOY_TTL_MS` | Không | Thời gian sống (TTL) của toy tính bằng milliseconds. |
| `TOY_CLEANUP_INTERVAL_MS` | Không | Chu kỳ cleanup để xóa toy hết hạn (milliseconds). |

### `.env.staging` và `.env.production` (input lúc deploy)

Các file này được `deploy.js` dùng để sinh `wrangler.toml` và route bindings,
đồng thời cũng có thể mang theo các runtime policy settings.

| Key | Bắt buộc khi deploy | Mục đích |
| --- | --- | --- |
| `DOMAIN` | Có | Tên zone Cloudflare dùng làm `zone_name` trong route binding. |
| `API_SUBDOMAIN` | Có | Tiền tố host cho API; host cuối cùng là `<API_SUBDOMAIN>.<DOMAIN>`. |
| `CORS_ORIGINS` | Có | Danh sách CORS allowlist được inject vào worker vars lúc runtime. |
| `CLOUDFLARE_KV_PREFIX` | Không (khuyến nghị) | Prefix gắn trước mọi KV key để cô lập service này trong namespace dùng chung. |
| `KV_NAMESPACE_ID` | Có | ID của KV namespace được bind vào `TOY_STATE`. |
| `APP_NAME` | Không | Nhãn ứng dụng cho log/debug context lúc runtime. |
| `SECURITY_HEADERS_ENABLED` | Không (khuyến nghị) | Bật security headers trong response lúc runtime. |
| `BASIC_AUTH_ENABLED` | Không | Cờ bật/tắt Basic Auth lúc runtime. |
| `BASIC_AUTH_REALM` | Không | Chuỗi realm cho auth challenge. |
| `BASIC_AUTH_USERNAME` | Bắt buộc khi bật auth | Tên người dùng Basic Auth (nên dùng Wrangler secrets trong production). |
| `BASIC_AUTH_PASSWORD` | Bắt buộc khi bật auth | Mật khẩu Basic Auth (nên dùng Wrangler secrets trong production). |
| `RATE_LIMIT_ENABLED` | Không | Bật/tắt rate limiting cho `POST /api/toys` theo IP. |
| `RATE_LIMIT_MAX` | Không | Số lần tạo tối đa trong mỗi cửa sổ rate-limit. |
| `RATE_LIMIT_WINDOW_MS` | Không | Độ dài cửa sổ rate-limit tính bằng milliseconds. |
| `MAX_ACTIVE_TOYS_GLOBAL` | Không | Giới hạn tổng số toy active trên toàn bộ client. |
| `MAX_TOYS_PER_IP` | Không | Quota toy active mặc định cho mỗi IP. |
| `SEED_MAX_TOYS_PER_IP` | Không | Quota mở rộng cho mỗi IP trong seed window. |
| `SEED_WINDOW_MS` | Không | Thời lượng seed window tính bằng milliseconds. |
| `TOY_TTL_MS` | Không | Thời gian sống (TTL) của toy tính bằng milliseconds. |
| `TOY_CLEANUP_INTERVAL_MS` | Không | Chu kỳ cleanup để xóa toy hết hạn (milliseconds). |

## Tổng quan deploy

- `npm run deploy` sẽ chạy `node deploy.js`.
- Môi trường deploy được chọn theo nhánh git hiện tại:
  - `main` hoặc `master` => `production`
  - `staging` hoặc `stag` => `staging`
  - Các nhánh khác sẽ bị từ chối.

## Deploy lên staging

1. Checkout nhánh `staging` (hoặc `stag`).

2. Chuẩn bị giá trị cho staging (dự án đã có `.env.staging.example`):

```bash
cp .env.staging.example .env.staging
```

3. Đảm bảo cấu hình staging tồn tại ở cả hai nơi:
- `wrangler.template.toml` cần có `[env.staging]` cho `npm run check:stag`.
- `wrangler.toml` cần có `[env.staging]` cho `npm run deploy` trên nhánh staging.

4. Chạy kiểm tra dry-run cho staging:

```bash
npm run check:stag
```

5. Deploy:

```bash
npm run deploy
```

Lưu ý: `wrangler.template.toml` hiện chỉ định nghĩa `development` và `production`. Nếu thiếu `[env.staging]`, các lệnh staging sẽ lỗi với thông báo `No environment found ... staging`.

## Deploy lên production

1. Checkout nhánh `main` (hoặc `master`).

2. Tạo file env cho production:

```bash
cp .env.production.example .env.production
```

3. Điền các khóa bắt buộc trong `.env.production`.

Dùng bảng trong phần `Tham chiếu khóa cấu hình` phía trên. Tối thiểu cần có:
- `DOMAIN`
- `API_SUBDOMAIN`
- `CORS_ORIGINS`
- `KV_NAMESPACE_ID`

Ví dụ sinh route:
- Nếu `DOMAIN=myapp-toy.com` và `API_SUBDOMAIN=toy-api-server-cf`, script deploy sẽ tạo route pattern `toy-api-server-cf.myapp-toy.com/*`.

`DOMAIN` và `API_SUBDOMAIN` là biến dùng lúc deploy để `deploy.js` sinh `wrangler.toml`, không phải biến runtime được handler đọc trực tiếp từ request.

4. Chạy kiểm tra dry-run cho production:

```bash
npm run check:prod
```

`npm run check:prod` phải được chạy từ `main` hoặc `master` vì `deploy.js` phụ thuộc vào nhánh hiện tại.

5. Deploy:

```bash
npm run deploy
```

Trong production, `deploy.js` sinh `wrangler.toml` từ `wrangler.template.toml`, inject routes/KV placeholders, rồi chạy Wrangler deploy.

## Thiết lập KV namespace

Tạo KV namespace ID trước lần deploy thực tế đầu tiên:

```bash
npx wrangler kv namespace create TOY_STATE
npx wrangler kv namespace create TOY_STATE --preview
```

## Test và curl

Chạy smoke test với khả năng tự khởi động server:

```bash
npm run test:api
```

Hành vi mặc định của `npm run test:api`:

- Nếu API server đã chạy tại `API_BASE_URL` (mặc định `http://127.0.0.1:8787`), test sẽ dùng lại server đó.
- Nếu API server chưa chạy, test runner sẽ tự khởi động `wrangler dev`, chờ `/healthz`, chạy test, rồi dừng server.

Chỉ cần tự chạy Worker thủ công khi thật sự cần:

```bash
npm run dev
```

Chạy file test Node thô (yêu cầu server đã chạy sẵn):

```bash
npm run test:api:raw
```

Chạy curl script để kiểm tra response nhanh:

```bash
npm run curl:api
```

`curl:api` hiện xác thực mã HTTP status mong đợi ở từng bước và sẽ thoát với mã lỗi khác 0 nếu có sai lệch.

Chạy light load test cho hành vi tạo đồng thời:

```bash
npm run test:load
```

`test:load` có thể tự khởi động Worker cục bộ và in ra JSON summary (phân bố status, số ID duy nhất, danh sách record, kết quả cleanup).

Tùy chọn override base URL:

```bash
BASE_URL=http://127.0.0.1:8788 npm run curl:api
API_BASE_URL=http://127.0.0.1:8788 npm run test:api
API_BASE_URL=http://127.0.0.1:8788 npm run test:load
```

Tùy chọn cho test runner:

```bash
# Tắt auto-start và yêu cầu server ngoài chạy sẵn
API_TEST_AUTOSTART=false npm run test:api

# Điều chỉnh timeout chờ server khởi động (milliseconds)
API_TEST_STARTUP_TIMEOUT_MS=60000 npm run test:api
```

Tùy chọn cho load test:

```bash
# Cấu hình profile request
LOAD_TEST_TOTAL_REQUESTS=120 LOAD_TEST_CONCURRENCY=24 npm run test:load

# Tắt auto-start và yêu cầu server ngoài chạy sẵn
LOAD_TEST_AUTOSTART=false npm run test:load

# Giữ lại dữ liệu test để kiểm tra thủ công
LOAD_TEST_CLEANUP=false npm run test:load
```

Nếu Basic Auth đang bật, export credentials trước khi chạy test/curl:

```bash
export BASIC_AUTH_USERNAME=admin
export BASIC_AUTH_PASSWORD=change-me
```

## Ghi chú về hành vi create/list

- Nếu bạn gửi nhiều `POST /api/toys` từ cùng một IP, một số request có thể trả về `429` do policy rate/quota theo IP.
- ID của toy không còn được cấp phát tuần tự. Thay vào đó, hệ thống dùng safe integer ngẫu nhiên chống va chạm để tránh ghi đè key khi tạo đồng thời.
