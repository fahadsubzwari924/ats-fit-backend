# Railway Deployment Plan — ats-fit-backend (NestJS)

## Goal

Deploy NestJS API to Railway as service `tairly-api`, served at `https://api.tairly.com`. Manual deploy via `npm run deploy:prod`. Patch deploys via Docker layer caching, no fresh setup each run.

## Architecture

- **Railway project**: `tairly` (shared with `tairly-web`).
- **Service**: `tairly-api`.
- **Database**: Railway-managed Postgres plugin in same project. Inject via reference variable `${{Postgres.DATABASE_URL}}`.
- **Domain**: `api.tairly.com` → Railway service. Cloudflare DNS CNAME, proxy OFF (DNS only) so Railway can issue TLS cert.
- **Builder**: Dockerfile (multi-stage). Override Railway nixpacks default for control + Puppeteer/Chromium support.

## Constraints / gotchas

- **Puppeteer**: existing Dockerfile installs `chromium` via `apk`. Keep that. Set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (already done).
- **Port**: Railway injects `PORT`. NestJS must read it (`process.env.PORT`).
- **Platform**: drop `--platform=linux/amd64` from existing Dockerfile — Railway runs amd64 by default; pinning blocks ARM-cached build steps if you ever build locally on Apple Silicon.
- **Migrations**: must run before app boot on each deploy. Use Railway pre-deploy command, not manual.
- **Resume templates**: existing Dockerfile copies `src/resume-templates`. Preserve.
- **Non-root user**: keep `nestjs:nodejs` user. Security best practice.
- **Signal handling**: keep `dumb-init` for clean shutdown.

## Tasks

### 1. Railway project + service setup (one-time, manual)

- [ ] Install Railway CLI: `npm i -g @railway/cli`.
- [ ] `railway login`.
- [ ] Create project `tairly` (Railway dashboard or `railway init`).
- [ ] Add Postgres plugin to project (dashboard → New → Database → Postgres).
- [ ] Create empty service `tairly-api` (dashboard → New → Empty Service).
- [ ] In repo root: `railway link` → pick `tairly` project + `tairly-api` service.

### 2. Dockerfile — adapt existing for Railway

- [ ] Remove `--platform=linux/amd64` from base image line.
- [ ] Change `EXPOSE 8080` → `EXPOSE 3000` (or leave — Railway uses `PORT` env, not EXPOSE).
- [ ] Verify `dist/main.js` reads `process.env.PORT`. Patch `src/main.ts` if hardcoded.
- [ ] Keep multi-stage: base → dependencies → builder → production.
- [ ] Keep Puppeteer/Chromium apk install in base layer (cached, only rebuild on apk-list change).
- [ ] Keep non-root user + `dumb-init`.

### 3. `.dockerignore` — verify or create

```
node_modules
dist
coverage
.git
.env*
*.log
.vscode
.idea
test
docs
postman
vendor
cloud-sql-proxy
*.md
docker-compose*.yml
Makefile
```

Critical: without this, build context bloats, layer cache invalidates on unrelated edits.

### 4. `railway.toml` — verify or write

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/main.js"
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
preDeployCommand = "npm run migration:run"
```

`preDeployCommand` runs migrations before traffic shifts to new container. If migration fails, deploy fails, old container keeps serving — safe.

### 5. Health endpoint

- [ ] Install `@nestjs/terminus` if not present.
- [ ] Add `HealthModule` exposing `GET /health`. Return 200 with DB ping + basic checks.
- [ ] Verify route is public (no auth guard).

### 6. Env validation

- [ ] Install `joi` if not present.
- [ ] Create `src/config/env.validation.ts` with schema for: `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, plus existing app-specific keys (S3, mail, etc. — audit current `.env` and add all).
- [ ] Wire into `ConfigModule.forRoot({ validationSchema, validationOptions: { abortEarly: true } })`.
- [ ] Update `.env.example` with all keys, no values.
- [ ] Confirm `.env*` in `.gitignore` and `.dockerignore`.

### 7. CORS

- [ ] In `main.ts`, set CORS origin from `process.env.CORS_ORIGIN`. Production value: `https://app.tairly.com`. Allow credentials if cookie auth used.

### 8. Railway env vars (set via CLI or dashboard)

```bash
railway variables \
  --set "NODE_ENV=production" \
  --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --set "JWT_SECRET=<generate-via-crypto-randomBytes-48>" \
  --set "JWT_EXPIRES_IN=7d" \
  --set "CORS_ORIGIN=https://app.tairly.com" \
  --service tairly-api
```

Add all other prod values (S3 keys, mail provider, etc.) — audit `.env.example` against existing local `.env`.

### 9. Custom domain

- [ ] Railway dashboard → `tairly-api` service → Settings → Networking → Custom Domain → `api.tairly.com`.
- [ ] Railway gives CNAME target.
- [ ] Cloudflare DNS: add CNAME `api` → Railway target. Proxy status DNS only (grey cloud).
- [ ] Wait for cert issuance (~1–2 min).

### 10. Deploy script

Add to `package.json`:

```json
"scripts": {
  "predeploy:prod": "npm run lint && npm run build",
  "deploy:prod": "railway up --service tairly-api --environment production --detach"
}
```

`predeploy:prod` runs first automatically. If lint or build fail, no upload.

### 11. First deploy + verification

- [ ] Local sanity: `docker build -t tairly-api . && docker run --rm -p 3000:3000 --env-file .env tairly-api` — confirm boot.
- [ ] `npm run deploy:prod`.
- [ ] `railway logs --service tairly-api` — watch build + boot.
- [ ] Verify migration ran (logs show migrations applied).
- [ ] `curl https://api.tairly.com/health` → 200.
- [ ] Hit a real endpoint to confirm DB connectivity.

### 12. Post-deploy hygiene

- [ ] Document deploy steps in `docs/DEPLOYMENT.md` (one-pager: prereqs, command, troubleshooting).
- [ ] Verify Railway resource limits (memory, CPU) match expected load — bump if needed.
- [ ] Confirm log retention setting acceptable.

## Patch-deploy mechanism (how subsequent deploys stay fast)

- Docker layer order: base → apk install (cached) → `package*.json` only (cached if unchanged) → `npm ci` (cached if `package-lock.json` unchanged) → `COPY . .` → `npm run build`.
- `.dockerignore` keeps build context small — uploads are diff-friendly.
- Railway BuildKit caches layers across deploys per service.
- Result: code-only change ≈ 30–60s deploy. Dep change ≈ 2–3 min. Base image change rare.

## Rollback

`railway rollback --service tairly-api` reverts to previous deployment. Use if deploy passed health check but produced runtime regressions.

## Open items / decide later

- Sentry / log shipping: not in scope now. Note for follow-up.
- Backups for Postgres: Railway has automated backups on paid plan — verify enabled.
- Rate limiting at ingress: NestJS-level for now, add Cloudflare rule if needed.
