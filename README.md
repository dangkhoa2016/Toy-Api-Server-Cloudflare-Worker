# Toy API Server - Cloudflare Worker

Cloudflare Worker implementation for migrating from the Node.js Fastify project.

## Current scope

- Scaffold Worker project with Wrangler.
- Port core constants and policy defaults.
- Port shared helpers: HTTP payload, client key parsing, CORS, basic auth, request validation.
- Align naming with Node.js project style:
  - `src/lib/variables.js`
  - `src/lib/request_client.js`
  - `src/services/toys_service.js`
  - `src/stores/kv_state_store.js`
  - `src/stores/kv_toy_store.js`
- Split and group routes for readability:
  - `src/routes/home.js`
  - `src/routes/errors.js`
  - `src/routes/toys.js`
- Implement system routes:
  - `GET /`
  - `GET /health`
  - `GET /docs`
  - `GET /openapi.json`
  - `GET /404`
  - `GET /500`
  - `GET /favicon.ico`
  - `GET /favicon.png`
- Implement toy routes on KV:
  - `GET /api/toys`
  - `GET /api/toys/export`
  - `POST /api/toys`
  - `GET /api/toys/:id`
  - `PATCH|PUT|POST /api/toys/:id`
  - `PATCH|PUT|POST /api/toys/:id/likes`
  - `DELETE /api/toys/:id`
- Add anti-abuse policy controls:
  - per-IP `POST /api/toys` rate limit
  - per-IP active toy quota with seed window expansion
  - global active toy cap
  - toy TTL and scheduled cleanup
- Serve docs and icons via static asset binding:
  - Worker assets directory: `src/assets`
  - `/docs` serves `src/assets/docs.html`
  - `/imgs/*`, `/favicon.ico`, `/favicon.png` are served via `ASSETS`
- Prevent same-isolate ID collision during concurrent create requests:
  - `POST /api/toys` is serialized through an in-memory create queue in `src/routes/toys.js`
- Add consistent response headers (`x-request-id`, `x-correlation-id`) and CORS preflight handling.

## Architecture snapshot

- Entry point and request pipeline: `src/index.js`
- Shared libs: `src/lib/*.js`
- Route modules: `src/routes/*.js`
- Domain service: `src/services/toys_service.js`
- KV stores: `src/stores/*.js`
- Static docs/icons: `src/assets/**`

## KV key naming

Cloudflare KV entries in `TOY_STATE` use prefixes to separate data domains:

| Prefix | Purpose | Managed in |
| --- | --- | --- |
| `<CLOUDFLARE_KV_PREFIX>:toy:<id>` | Toy entity payloads | `src/stores/kv_toy_store.js` |
| `<CLOUDFLARE_KV_PREFIX>:ratelimit:<clientKey>` | Per-client create rate-limit state (`count`, `resetAt`) | `src/stores/kv_state_store.js` |
| `<CLOUDFLARE_KV_PREFIX>:seed:<clientKey>` | Per-client seed-window state (`firstCreateAt`, `successfulCreates`) | `src/stores/kv_state_store.js` |

Default `CLOUDFLARE_KV_PREFIX` is `toy-api-server` when not explicitly configured.

`clientKey` is derived from request client identity (typically IP resolution in request handling).

## Local development

1. Install dependencies:

```bash
npm install
```

2. Login to Cloudflare (if needed):

```bash
npx wrangler login
```

3. Create local env file:

```bash
cp .dev.vars.example .dev.vars
```

4. Run locally:

```bash
npm run dev
```

`npm run dev` uses `wrangler.template.toml` with `--env development`.

## Configuration key reference

### `.dev.vars` (local runtime)

| Key | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | Runtime mode for local worker execution. |
| `CORS_ORIGINS` | Yes | Allowed browser origins for CORS. |
| `CLOUDFLARE_KV_PREFIX` | No (recommended) | Prefix prepended to all KV keys to isolate this service in shared namespaces. |
| `SECURITY_HEADERS_ENABLED` | No (recommended) | Enables security headers (`nosniff`, frame/referrer policy). |
| `APP_NAME` | No | App label for logs/debug context. |
| `BASIC_AUTH_ENABLED` | No | Turns HTTP Basic Auth middleware on/off. |
| `BASIC_AUTH_USERNAME` | Required when auth enabled | Basic auth username. |
| `BASIC_AUTH_PASSWORD` | Required when auth enabled | Basic auth password. |
| `BASIC_AUTH_REALM` | No | Realm text shown in auth challenge. |
| `RATE_LIMIT_ENABLED` | No (recommended) | Enables/disables per-IP `POST /api/toys` rate limiting. |
| `RATE_LIMIT_MAX` | No | Max allowed creates per rate-limit window. |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in milliseconds. |
| `MAX_ACTIVE_TOYS_GLOBAL` | No | Global cap for active toys across all clients. |
| `MAX_TOYS_PER_IP` | No | Default active toy quota per client IP. |
| `SEED_MAX_TOYS_PER_IP` | No | Expanded per-IP quota during seed window. |
| `SEED_WINDOW_MS` | No | Seed window duration in milliseconds. |
| `TOY_TTL_MS` | No | Toy time-to-live (TTL) in milliseconds. |
| `TOY_CLEANUP_INTERVAL_MS` | No | Cleanup interval for pruning expired toys (milliseconds). |

### `.env.staging` and `.env.production` (deploy-time inputs)

These files are consumed by `deploy.js` to generate `wrangler.toml` and route bindings,
and can also carry runtime policy settings.

| Key | Required for deploy | Purpose |
| --- | --- | --- |
| `DOMAIN` | Yes | Cloudflare zone name used as `zone_name` in route binding. |
| `API_SUBDOMAIN` | Yes | API host prefix; final host is `<API_SUBDOMAIN>.<DOMAIN>`. |
| `CORS_ORIGINS` | Yes | Runtime CORS allowlist injected into worker vars. |
| `CLOUDFLARE_KV_PREFIX` | No (recommended) | Prefix prepended to all KV keys to isolate this service in shared namespaces. |
| `KV_NAMESPACE_ID` | Yes | KV namespace ID bound to `TOY_STATE`. |
| `APP_NAME` | No | Runtime app label for logs/debug context. |
| `SECURITY_HEADERS_ENABLED` | No (recommended) | Enables security headers in runtime responses. |
| `BASIC_AUTH_ENABLED` | No | Basic auth runtime policy toggle. |
| `BASIC_AUTH_REALM` | No | Realm text for auth challenge. |
| `BASIC_AUTH_USERNAME` | Required when auth enabled | Basic auth username (prefer Wrangler secrets in production). |
| `BASIC_AUTH_PASSWORD` | Required when auth enabled | Basic auth password (prefer Wrangler secrets in production). |
| `RATE_LIMIT_ENABLED` | No | Enables/disables per-IP `POST /api/toys` rate limiting. |
| `RATE_LIMIT_MAX` | No | Max allowed creates per rate-limit window. |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in milliseconds. |
| `MAX_ACTIVE_TOYS_GLOBAL` | No | Global cap for active toys across all clients. |
| `MAX_TOYS_PER_IP` | No | Default active toy quota per client IP. |
| `SEED_MAX_TOYS_PER_IP` | No | Expanded per-IP quota during seed window. |
| `SEED_WINDOW_MS` | No | Seed window duration in milliseconds. |
| `TOY_TTL_MS` | No | Toy time-to-live (TTL) in milliseconds. |
| `TOY_CLEANUP_INTERVAL_MS` | No | Cleanup interval for pruning expired toys (milliseconds). |

## Deployment overview

- `npm run deploy` runs `node deploy.js`.
- Deploy target is selected by current git branch:
  - `main` or `master` => `production`
  - `staging` or `stag` => `staging`
  - Other branches are rejected.

## Deploy to staging

1. Checkout `staging` (or `stag`) branch.

2. Prepare staging values (project already includes `.env.staging.example`):

```bash
cp .env.staging.example .env.staging
```

3. Ensure staging config exists in both places:
- `wrangler.template.toml` needs `[env.staging]` for `npm run check:stag`.
- `wrangler.toml` needs `[env.staging]` for `npm run deploy` on staging branch.

4. Run staging dry-run check:

```bash
npm run check:stag
```

5. Deploy:

```bash
npm run deploy
```

Note: `wrangler.template.toml` currently defines `development` and `production` only. If `[env.staging]` is missing, staging commands will fail with `No environment found ... staging`.

## Deploy to production

1. Checkout `main` (or `master`) branch.

2. Create production env file:

```bash
cp .env.production.example .env.production
```

3. Fill required keys in `.env.production`.

Use the table in `Configuration key reference` above. At minimum, set:
- `DOMAIN`
- `API_SUBDOMAIN`
- `CORS_ORIGINS`
- `KV_NAMESPACE_ID`

Example route generation:
- If `DOMAIN=myapp-toy.com` and `API_SUBDOMAIN=toy-api-server-cf`, deploy script generates route pattern `toy-api-server-cf.myapp-toy.com/*`.

`DOMAIN` and `API_SUBDOMAIN` are deployment-time variables (used by `deploy.js` to generate `wrangler.toml`), not request-time variables read by Worker handlers.

4. Run production dry-run check:

```bash
npm run check:prod
```

`npm run check:prod` must be run from `main` or `master` because `deploy.js` is branch-based.

5. Deploy:

```bash
npm run deploy
```

For production, `deploy.js` generates `wrangler.toml` from `wrangler.template.toml`, injects routes/KV placeholders, then runs Wrangler deploy.

## KV namespace setup

Create KV namespace IDs before first real deployment:

```bash
npx wrangler kv namespace create TOY_STATE
npx wrangler kv namespace create TOY_STATE --preview
```

## Test and curl

Start the Worker first:

```bash
npm run dev
```

Run smoke tests with Node test runner:

```bash
npm run test:api
```

Run curl script to inspect responses quickly:

```bash
npm run curl:api
```

`curl:api` now validates expected HTTP status codes for each step and exits non-zero on mismatches.

Optional base URL override:

```bash
BASE_URL=http://127.0.0.1:8788 npm run curl:api
API_BASE_URL=http://127.0.0.1:8788 npm run test:api
```

If Basic Auth is enabled, export credentials before running test/curl:

```bash
export BASIC_AUTH_USERNAME=admin
export BASIC_AUTH_PASSWORD=change-me
```

## Notes on create/list behavior

- If you send many `POST /api/toys` requests from the same IP, some requests can return `429` because of per-IP rate/quota policy.
- Concurrent creates are serialized per isolate to reduce KV key overwrite races when allocating new toy IDs.
