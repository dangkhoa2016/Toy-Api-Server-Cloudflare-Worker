# Toy API Server - Cloudflare Worker

Cloudflare Worker implementation for migrating from the Node.js Fastify project.

## Current scope

- Scaffold Worker project with Wrangler.
- Port core constants and policy defaults.
- Port shared helpers: HTTP payload, client key parsing, CORS, basic auth, request validation.
- Implement system routes:
  - `GET /`
  - `GET /health`
  - `GET /docs`
  - `GET /openapi.json`
  - `GET /404`
  - `GET /500`
  - `GET /favicon.ico`
  - `GET /favicon.png`
- Add consistent response headers (`x-request-id`, `x-correlation-id`) and CORS preflight handling.

`/api/toys*` routes are not implemented yet and currently return `501`.

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
| `SECURITY_HEADERS_ENABLED` | No (recommended) | Enables security headers (`nosniff`, frame/referrer policy). |
| `APP_NAME` | No | App label for logs/debug context. |
| `BASIC_AUTH_ENABLED` | No | Turns HTTP Basic Auth middleware on/off. |
| `BASIC_AUTH_USERNAME` | Required when auth enabled | Basic auth username. |
| `BASIC_AUTH_PASSWORD` | Required when auth enabled | Basic auth password. |
| `BASIC_AUTH_REALM` | No | Realm text shown in auth challenge. |

### `.env.staging` and `.env.production` (deploy-time inputs)

These files are consumed by `deploy.js` to generate `wrangler.toml` and route bindings.

| Key | Required for deploy | Purpose |
| --- | --- | --- |
| `DOMAIN` | Yes | Cloudflare zone name used as `zone_name` in route binding. |
| `API_SUBDOMAIN` | Yes | API host prefix; final host is `<API_SUBDOMAIN>.<DOMAIN>`. |
| `CORS_ORIGINS` | Yes | Runtime CORS allowlist injected into worker vars. |
| `KV_NAMESPACE_ID` | Yes | KV namespace ID bound to `TOY_STATE`. |
| `APP_NAME` | No | Runtime app label for logs/debug context. |
| `SECURITY_HEADERS_ENABLED` | No (recommended) | Enables security headers in runtime responses. |
| `BASIC_AUTH_ENABLED` | No | Basic auth runtime policy toggle. |
| `BASIC_AUTH_REALM` | No | Realm text for auth challenge. |
| `BASIC_AUTH_USERNAME` | Required when auth enabled | Basic auth username (prefer Wrangler secrets in production). |
| `BASIC_AUTH_PASSWORD` | Required when auth enabled | Basic auth password (prefer Wrangler secrets in production). |

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
