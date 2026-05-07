# Railway Deployment Plan — ats-fit-backend (NestJS)

**Master plan:** see [`../DEPLOYMENT_PLAN.md`](../DEPLOYMENT_PLAN.md). This file covers the backend repo specifically.

## Goal

Deploy NestJS API to Railway as service `tairly-api` in the `tairly` project, served at `https://api.tairly.com`. Manual deploy via single command: `npm run deploy`. Patch deploys via Docker layer caching.

## Architecture

- **Railway project**: `tairly` (shared with `tairly-web`).
- **Service**: `tairly-api`.
- **Database**: Railway-managed Postgres plugin in same project. Inject via reference variable `${{Postgres.DATABASE_URL}}`.
- **Cache/Queue**: Railway-managed Redis plugin in same project. Required by `BullModule` and any caching code. Inject via `${{Redis.REDIS_URL}}` plus discrete host/port/password vars (see env section).
- **Domain**: `api.tairly.com` → Railway service. Cloudflare DNS CNAME, **proxy OFF (DNS only)** so Railway can issue TLS cert.
- **Builder**: Dockerfile (multi-stage). Override Railway nixpacks default for control + Puppeteer/Chromium support.

## Constraints / gotchas

- **Health endpoint path**: `main.ts` calls `app.setGlobalPrefix('api')`, so all routes are prefixed. Health check must be at `/api/health`, NOT `/health` — Railway will mark every deploy unhealthy otherwise.
- **Bootstrap-time env vars**: `main.ts:25` calls `lemonSqueezySetup({ apiKey: process.env.LEMON_SQUEEZY_API_KEY })`. If `LEMON_SQUEEZY_API_KEY` is missing, the LS SDK silently misbehaves later. Validate at boot via `joi`.
- **Puppeteer**: existing Dockerfile installs `chromium` via `apk`. Keep that. `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` already set in Dockerfile.
- **Port**: Railway injects `PORT`. `main.ts:136` reads `process.env.PORT || 3000` — already correct.
- **Platform**: drop `--platform=linux/amd64` from Dockerfile — Railway runs amd64 by default; pinning blocks ARM-cached build steps if you ever build locally on Apple Silicon.
- **Migrations**: must run before app boot on each deploy. Use Railway pre-deploy command, not manual.
- **Resume templates + email templates**: existing Dockerfile copies `src/resume-templates`. Also copy `src/email-templates`. Preserve both.
- **Non-root user + dumb-init**: keep both. Security + clean signal handling.
- **CORS**: `main.ts:37` currently sets `origin: true` (allow all). MUST be locked to `process.env.CORS_ORIGIN` for prod (`https://app.tairly.com`), else production is open to any origin.

## Tasks

### 1. Delete legacy GCP/Cloud Run files

Old GCP-based deploy infrastructure must go. Per user instruction, delete entirely (do not move to `_legacy/`):

```bash
cd ats-fit-backend
rm -rf scripts/deployment/                  # deploy.sh, env-manager.sh, env-sync.sh, post-deploy.sh, parse-env.py
rm -rf scripts/database/                    # if it only contains GCP-targeted db-manager.sh — verify first
rm -rf scripts/utilities/                   # if it only contains GCP-targeted dev-utils.sh — verify first
rm -f cloud-run-service.yaml cloud-run-service-secure.yaml
rm -f cloud-sql-proxy
rm -f start-proxy.sh
rm -f .makefile-help.md
rm -f Makefile                              # only if it's GCP-only — verify first
```

After deletion, also remove the corresponding scripts from `package.json`:
- `deploy`, `deploy:dev`, `deploy:staging`, `deploy:prod` (legacy versions)
- `logs`, `logs:dev`, `status`, `scale`, `rollback` (env-manager based)
- `db:migrate`, `db:seed`, `db:backup`, `db:connect`, `db:status`, `db:proxy` (db-manager based)
- `dev:test-api`, `dev:health`, `dev:metrics`, `dev:logs`, `dev:cleanup`, `dev:validate`
- All `docker:*` scripts that wrap the Makefile

Keep: `build`, `start*`, `lint`, `test*`, `format`, `seed:*`, `migration:*`, `typeorm`, `ngrok*`. Add new `deploy` (see task 10).

### 2. Railway project + service setup (one-time, manual)

- [ ] Install Railway CLI: `npm i -g @railway/cli`.
- [ ] `railway login`.
- [ ] Create project `tairly` (Railway dashboard).
- [ ] Inside project, add **Postgres** plugin (dashboard → New → Database → PostgreSQL).
- [ ] Inside project, add **Redis** plugin (dashboard → New → Database → Redis).
- [ ] Create empty service `tairly-api` (dashboard → New → Empty Service).
- [ ] In `ats-fit-backend/` locally: `railway link` → pick `tairly` project + `tairly-api` service.

### 3. Dockerfile — adapt existing for Railway

Edit `Dockerfile`:

- [ ] Change `FROM --platform=linux/amd64 node:20-alpine AS base` → `FROM node:20-alpine AS base`.
- [ ] Change `EXPOSE 8080` → `EXPOSE 3000` (cosmetic — Railway uses `PORT` env, not EXPOSE; but matches the `main.ts` default).
- [ ] Add line copying email templates: after `COPY --from=builder ... ./src/resume-templates`, add:
  ```dockerfile
  COPY --from=builder --chown=nestjs:nodejs /usr/src/app/src/email-templates ./src/email-templates
  ```
- [ ] Update header comment block — it currently says "optimized for Google Cloud Run". Replace with "optimized for Railway".

Keep everything else: multi-stage layout, Puppeteer apk install, non-root user, dumb-init.

### 4. `.dockerignore` — verify or create at repo root

```
node_modules
dist
coverage
.git
.env*
*.log
.vscode
.idea
.claude
.ai
.worktrees
test
docs
postman
vendor
cloud-sql-proxy
*.md
docker-compose*.yml
Makefile
.github
scripts/_legacy*
```

Critical: without this, build context bloats, layer cache invalidates on unrelated edits.

### 5. `railway.toml` — write at repo root

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/main.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
preDeployCommand = "npm run migration:run"
```

`preDeployCommand` runs migrations before traffic shifts to new container. If migration fails, deploy fails, old container keeps serving — safe.

### 6. Health endpoint

- [ ] Install `@nestjs/terminus` if not present: `npm i @nestjs/terminus`.
- [ ] Create `src/health/health.module.ts` and `src/health/health.controller.ts`. Controller exposes `GET /health` (which becomes `/api/health` due to global prefix). Return 200 with DB ping + Redis ping. Example:
  ```ts
  @Controller('health')
  export class HealthController {
    constructor(
      private health: HealthCheckService,
      private db: TypeOrmHealthIndicator,
    ) {}

    @Get()
    @HealthCheck()
    check() {
      return this.health.check([() => this.db.pingCheck('database')]);
    }
  }
  ```
- [ ] Wire `HealthModule` into `AppModule`.
- [ ] Verify route is public (no auth guard). Manually exclude from any global guards.

### 7. Env validation

- [ ] `joi` is already in dependencies — good.
- [ ] Create `src/config/env.validation.ts`:
  ```ts
  import * as Joi from 'joi';

  export const envValidationSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'staging', 'production').required(),
    PORT: Joi.number().default(3000),

    // Database
    DATABASE_URL: Joi.string().uri().required(),

    // Redis
    REDIS_URL: Joi.string().uri().optional(),
    REDIS_HOST: Joi.string().required(),
    REDIS_PORT: Joi.number().required(),
    REDIS_PASSWORD: Joi.string().allow('').optional(),
    REDIS_DB: Joi.number().default(0),

    // Auth
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRES_IN: Joi.string().default('7d'),
    CORS_ORIGIN: Joi.string().uri().required(),

    // AI providers
    OPENAI_API_KEY: Joi.string().required(),
    ANTHROPIC_API_KEY: Joi.string().required(),
    CLAUDE_MODEL: Joi.string().required(),
    CLAUDE_ENRICHMENT_MODEL: Joi.string().required(),

    // Payments
    LEMON_SQUEEZY_API_KEY: Joi.string().required(),
    LEMON_SQUEEZY_STORE_ID: Joi.string().required(),
    LEMON_SQUEEZY_WEBHOOK_SECRET: Joi.string().required(),

    // AWS (S3 + SES)
    AWS_ACCESS_KEY_ID: Joi.string().required(),
    AWS_SECRET_ACCESS_KEY: Joi.string().required(),
    AWS_S3_BUCKET: Joi.string().required(),
    AWS_REGION: Joi.string().required(),

    // Google OAuth
    GOOGLE_CLIENT_ID: Joi.string().required(),
    GOOGLE_CLIENT_SECRET: Joi.string().required(),
  });
  ```
  Audit your current local `.env` and add any other keys the codebase reads.
- [ ] Wire into `ConfigModule.forRoot({ validationSchema: envValidationSchema, validationOptions: { abortEarly: true } })` in `app.module.ts`.
- [ ] Update `.env.template` with every key (no values).
- [ ] Confirm `.env*` already in `.gitignore` and `.dockerignore`.

### 8. CORS lock-down

In `main.ts`, replace the current `app.enableCors({ origin: true, ... })` with:

```ts
app.enableCors({
  origin: process.env.CORS_ORIGIN,   // 'https://app.tairly.com' in prod
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [/* keep existing list */],
  exposedHeaders: [/* keep existing list */],
});
```

For local dev, set `CORS_ORIGIN=http://localhost:4200` in `.env`.

### 9. Railway env vars

**Source of truth: `src/config/.env.prod`.** Do not set vars manually via the Railway dashboard. Use the sync script instead:

```bash
npm run sync:env
```

This reads `src/config/.env.prod`, strips comments and blank lines, and calls `railway variables set` for each key. Run it once on first setup, and again whenever you add or change a variable. Railway merges — it does not wipe existing vars.

**What the sync script sets (reference):**

```
# Core
NODE_ENV=production
APP_ENV=production
PORT=${{PORT}}
APP_URL=https://api.tairly.com
APP_BASE_URL=https://api.tairly.com
FRONTEND_URL=https://app.tairly.com
SUBSCRIPTION_SUCCESS_URL=https://app.tairly.com/billing

# Database (Railway reference variable — do not change this line)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (Railway reference variables)
REDIS_URL=${{Redis.REDIS_URL}}
REDIS_HOST=${{Redis.REDISHOST}}
REDIS_PORT=${{Redis.REDISPORT}}
REDIS_PASSWORD=${{Redis.REDISPASSWORD}}
REDIS_DB=0

# Auth
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://app.tairly.com

# OpenAI
OPENAI_API_KEY=<prod key from platform.openai.com>
OPENAI_MAX_RETRIES=3
OPENAI_RETRY_DELAY=1000

# Anthropic / Claude
ANTHROPIC_API_KEY=<prod key from console.anthropic.com>
CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_ENRICHMENT_MODEL=claude-haiku-4-5-20251001
CLAUDE_MAX_RETRIES=3
CLAUDE_RETRY_DELAY=1000

# AWS (S3 + SES) — note: two separate IAM users in .env.dev; consolidate to one prod IAM user or keep split
AWS_ACCESS_KEY_ID=<prod IAM key — S3 access>
AWS_SECRET_ACCESS_KEY=<prod IAM secret>
AWS_REGION=ap-south-1
AWS_BUCKET_REGION=ap-south-1
AWS_S3_BUCKET=<prod general bucket if used>
AWS_S3_RESUME_TEMPLATES_BUCKET=<prod bucket for template HTML + thumbnails>
AWS_S3_CANDIDATES_RESUMES_BUCKET=<prod bucket for user uploaded/generated resumes>
AWS_S3_BUCKET_ATS_FIT_EMAIL_TEMPLATES=ats-fit-email-templates

# AWS SES — SDK credentials (not SMTP; codebase uses @aws-sdk/client-ses)
AWS_SES_USER_ACCESS_KEY_ID=<prod SES IAM key>
AWS_SES_USER_SECRET_ACCESS_KEY=<prod SES IAM secret>
AWS_SES_FROM_EMAIL=info@tairly.com
AWS_SES_FROM_NAME=Tairly

# Brevo — active transactional email provider
BREVO_API_KEY=<prod key>
BREVO_FROM_EMAIL=hello@tairly.com
BREVO_FROM_NAME=Tairly
BREVO_TEMPLATE_ID_PASSWORD_RESET=8
BREVO_TEMPLATE_ID_PASSWORD_CHANGED=10
BREVO_TEMPLATE_ID_BETA_INVITE=2
BREVO_TEMPLATE_ID_BETA_REDEEMED_WELCOME=3
BREVO_TEMPLATE_ID_BETA_EXPIRING_SOON=4
BREVO_TEMPLATE_ID_BETA_ENDED_OFFER=5
BREVO_TEMPLATE_ID_BETA_POST_EXPIRY_FOLLOWUP=6
BREVO_TEMPLATE_ID_BETA_DAY3_CHECKIN=7

# Google OAuth (note: key name is GOOGLE_SECRET_KEY, not GOOGLE_CLIENT_SECRET)
GOOGLE_CLIENT_ID=<prod Google OAuth client ID>
GOOGLE_SECRET_KEY=<prod Google OAuth client secret>

# LemonSqueezy (payments)
LEMON_SQUEEZY_API_KEY=<prod key from lemonsqueezy.com>
LEMON_SQUEEZY_STORE_NAME=ats-fit
LEMON_SQUEEZY_STORE_ID=<prod store ID>
LEMON_SQUEEZY_WEBHOOK_SECRET=<prod webhook secret>

# Admin / notifications
ADMIN_EMAILS=<your admin email>
CONTACT_NOTIFICATION_EMAIL=info@tairly.com

# Performance / cache
CACHE_TTL=1800000
MAX_CACHE_SIZE=1000
TEMPLATE_CACHE_TTL=600000
RESUME_SERVICE_CACHE_TTL=300000

# AI optimization
MAX_SKILLS_FOR_EMBEDDING=10
MAX_MISSING_SKILLS=5

# PDF generation
PDF_TIMEOUT=15000
PDF_PAGE_TIMEOUT=10000

# File limits
MAX_FILE_SIZE=5242880

# Ngrok — disable in production
ENABLE_NGROK=false
```

**Important notes:**
- `AWS_REGION` and `AWS_BUCKET_REGION` must both be set — codebase reads both key names in different places.
- `GOOGLE_SECRET_KEY` is the correct key name (not `GOOGLE_CLIENT_SECRET`) — confirm by grepping: `grep -r "GOOGLE_SECRET_KEY" src/`.
- Three distinct S3 buckets are required: `AWS_S3_RESUME_TEMPLATES_BUCKET`, `AWS_S3_CANDIDATES_RESUMES_BUCKET`, `AWS_S3_BUCKET_ATS_FIT_EMAIL_TEMPLATES`. All three must be pre-created in AWS S3 before first deploy.
- Do not set `PORT` manually — Railway injects it.
- Do not set `NGROK_AUTH_TOKEN` in production — it's a dev-only secret.

### 10. Single deploy script (`scripts/deploy.sh`)

Create the only deploy entry point. Replace any leftover `scripts/deployment/*`.

```bash
mkdir -p scripts
```

Create `scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# tairly-api — single-shot Railway deploy
# Usage: npm run deploy
# ---------------------------------------------------------------------------
set -euo pipefail

SERVICE="tairly-api"
HEALTH_URL="https://api.tairly.com/api/health"

echo "▶ Preflight: railway CLI present?"
command -v railway >/dev/null 2>&1 || { echo "❌ railway CLI not installed. Run: npm i -g @railway/cli"; exit 1; }

echo "▶ Preflight: logged in to Railway?"
railway whoami >/dev/null 2>&1 || { echo "❌ Not logged in. Run: railway login"; exit 1; }

echo "▶ Preflight: linked to a Railway service?"
railway status >/dev/null 2>&1 || { echo "❌ Not linked. Run: railway link"; exit 1; }

echo "▶ Lint"
npm run lint

echo "▶ Build (local sanity check — Railway will rebuild in container)"
npm run build

echo "▶ Deploying to Railway service: ${SERVICE}"
railway up --service "${SERVICE}" --environment production --detach

echo "▶ Deploy submitted. Tailing build/runtime logs (Ctrl-C to detach — deploy continues)..."
echo "   Health endpoint will be polled after build completes."
railway logs --service "${SERVICE}" &
LOGS_PID=$!

# Give Railway time to build + boot
sleep 90

echo "▶ Smoke test: ${HEALTH_URL}"
for attempt in {1..10}; do
  if curl -sf -o /dev/null -w "%{http_code}" "${HEALTH_URL}" | grep -q "200"; then
    echo "✅ ${HEALTH_URL} returned 200 — deploy looks healthy."
    kill ${LOGS_PID} 2>/dev/null || true
    exit 0
  fi
  echo "  attempt ${attempt}/10 — not ready yet, retrying in 15s..."
  sleep 15
done

echo "⚠️  Health check did not return 200 after 10 attempts."
echo "   Check Railway dashboard or run: railway logs --service ${SERVICE}"
echo "   Rollback if needed: railway rollback --service ${SERVICE}"
kill ${LOGS_PID} 2>/dev/null || true
exit 1
```

Make executable:
```bash
chmod +x scripts/deploy.sh
```

### 11. Wire single command in `package.json`

In `package.json`, replace the legacy deploy scripts with exactly one:

```json
"scripts": {
  "deploy": "bash scripts/deploy.sh"
}
```

Now `npm run deploy` is the only command needed for production deploys.

### 12. First deploy + verification

- [ ] Local sanity: `docker build -t tairly-api . && docker run --rm -p 3000:3000 --env-file .env tairly-api` — confirm boot.
- [ ] `npm run deploy`.
- [ ] Watch the logs the script tails. Look for: migrations applied → "🚀 Application is running on port…" → smoke test passes.
- [ ] If using Railway-provided domain (before custom domain): `curl https://<railway-domain>/api/health`.
- [ ] After custom domain wired (master plan phase 5): `curl https://api.tairly.com/api/health`.
- [ ] Hit a real authenticated endpoint to confirm DB connectivity.

### 13. Post-deploy hygiene

- [ ] Verify Railway resource limits (memory, CPU) match expected load — bump if needed.
- [ ] Confirm Postgres backups enabled (Railway Pro default).
- [ ] Confirm log retention setting acceptable.
- [ ] Update `README.md`: add a "Deploy" section pointing at `npm run deploy`.

## Patch-deploy mechanism (how subsequent deploys stay fast)

- Docker layer order: base → apk install (cached) → `package*.json` only (cached if unchanged) → `npm ci` (cached if `package-lock.json` unchanged) → `COPY . .` → `npm run build`.
- `.dockerignore` keeps build context small — uploads are diff-friendly.
- Railway BuildKit caches layers across deploys per service.
- Result: code-only change ≈ 30–60s deploy. Dep change ≈ 2–3 min. Base image change rare.

## Rollback

```bash
railway rollback --service tairly-api
```

Reverts to previous deployment. Use if deploy passed health check but produced runtime regressions.

## Initial data seeding (one-time, after first deploy)

Seeding is a **one-time manual step** run locally from your machine against the production database. It cannot run inside the Railway container because all seed scripts use `ts-node`, which is a devDependency not present in the production image.

Seeding order matters — run in exactly this sequence.

### Prerequisites before seeding

**Step A — Get the production DATABASE_URL from Railway:**
```bash
cd ats-fit-backend
railway variables --service tairly-api | grep DATABASE_URL
# Copy the full postgres://... connection string
```

**Step B — Create `src/config/.env.prod` from `.env.dev` as base:**

Seed scripts load from `src/config/.env.prod` when `NODE_ENV=production`. The source of truth for all key names is `src/config/.env.dev`. Create the prod file by copying it and then overriding only the prod-specific values:

```bash
# Start from .env.dev as base (it has all the correct key names)
cp src/config/.env.dev src/config/.env.prod
```

Now open `src/config/.env.prod` and change these values to their production equivalents:

| Key | Dev value (in .env.dev) | Change to |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `APP_ENV` | `development` | `production` |
| `DATABASE_HOST/PORT/USERNAME/PASSWORD/NAME` | local Docker values | remove these lines — `DATABASE_URL` covers it for Railway |
| `DATABASE_URL` | (not set in .env.dev) | paste from Step A above |
| `REDIS_HOST/PORT/PASSWORD` | local Docker values | the seed only needs DATABASE_URL, so these can stay or be blanked |
| `PORT` | `3002` | `3000` |
| `APP_URL` | `http://localhost:3000` | `https://api.tairly.com` |
| `APP_BASE_URL` | `http://localhost:3000` | `https://api.tairly.com` |
| `FRONTEND_URL` | `http://localhost:4200` | `https://app.tairly.com` |
| `SUBSCRIPTION_SUCCESS_URL` | `http://localhost:4200/billing` | `https://app.tairly.com/billing` |
| `JWT_SECRET` | dev value | generate fresh prod value |
| `ENABLE_NGROK` | `true` | `false` |
| `OPENAI_API_KEY` | dev key | prod key |
| `ANTHROPIC_API_KEY` | dev key | prod key |
| `LEMON_SQUEEZY_API_KEY` | dev key | prod key |
| `AWS_*` keys | dev credentials | prod credentials |
| `GOOGLE_SECRET_KEY` | dev value | prod value |
| `BREVO_API_KEY` | dev key | prod key |
| `MAILCHIMP_*` keys | dev keys | prod keys |

Everything else (key names, Brevo template IDs, bucket names if same in prod, region if same) can stay as-is from `.env.dev`.

Confirm `src/config/.env.prod` is git-ignored:
```bash
grep ".env.prod" .gitignore   # must appear
git status src/config/        # must show nothing tracked
```

**Step C — Ensure all three S3 buckets exist in AWS:**

Before running any seed, the buckets must already exist. Create them in the AWS S3 console if not already:
- Value of `AWS_S3_RESUME_TEMPLATES_BUCKET` — for resume template HTML + thumbnails
- Value of `AWS_S3_CANDIDATES_RESUMES_BUCKET` — for user-uploaded/generated resumes
- Value of `AWS_S3_BUCKET_ATS_FIT_EMAIL_TEMPLATES` (hardcoded as `ats-fit-email-templates`) — for transactional email templates

Bucket settings: block all public access (files are served via presigned URLs or through the app server, not directly).

**Step D — Update LemonSqueezy variant IDs in the seed file:**

`src/scripts/seed/seed-subscription-plans.ts:28` currently has:
```ts
payment_gateway_variant_id: 'PLACEHOLDER_MONTHLY_VARIANT_ID',
```
and:
```ts
payment_gateway_variant_id: 'PLACEHOLDER_ANNUAL_VARIANT_ID',
```

These MUST be replaced with real variant IDs from LemonSqueezy before seeding:

1. LemonSqueezy dashboard → Store → Products → select your product → Variants.
2. Copy the numeric variant ID for "Pro Monthly" plan.
3. Copy the numeric variant ID for "Pro Annual" plan.
4. Edit `src/scripts/seed/seed-subscription-plans.ts` and replace both placeholder strings with the real IDs.

These IDs are not secrets — they're publicly visible in checkout URLs — but they are account/environment specific so don't commit them to a shared repo if you have separate prod/dev LS accounts.

### Seed 1 — Subscription plans

```bash
cd ats-fit-backend
NODE_ENV=production npm run seed:subscription-plans
```

Expected output:
```
Seeded subscription plan: Pro Monthly - $12
Seeded subscription plan: Pro Annual - $89
All subscription plans seeded successfully.
```

This seed is idempotent — safe to re-run. It skips if plans already exist.

**Verify:**
```bash
railway run --service tairly-api -- node -e "
const { DataSource } = require('typeorm');
// Quick check — just confirm the table has rows
"
# Or check via your DB client using the DATABASE_URL from Railway
```

### Seed 2 — Resume templates (S3 upload + DB records)

This seed reads local files from `src/resume-templates/`, uploads each template HTML and thumbnail to S3, then saves metadata to the database.

```bash
cd ats-fit-backend
NODE_ENV=production npm run seed:resume-templates
```

Expected output: one block per template folder in `src/resume-templates/`, ending with:
```
All templates seeded successfully.
```

**Warning — not idempotent:** If run a second time, it will create duplicate DB rows. Only run once. If you add new templates later, add an idempotency guard (check by `key` column) to `seedResumeTemplates` first or manually delete the new template's row before re-running.

**Verify:** Hit `GET /api/v1/resume-templates` (or whichever endpoint lists templates) — confirm count matches the number of folders in `src/resume-templates/`.

### Seed 3 — Email templates (S3 upload only)

Uploads all `.hbs` and `.html` files from `src/email-templates/` to the `ats-fit-email-templates` S3 bucket.

```bash
cd ats-fit-backend
NODE_ENV=production npm run seed:email-templates
```

Expected output shows each file uploaded, ending with:
```
✓ All email templates uploaded successfully
```

This seed is idempotent — S3 puts overwrite existing objects. Safe to re-run whenever email templates change.

**Verify:** AWS S3 console → `ats-fit-email-templates` bucket → confirm `email-templates/` prefix contains your `.hbs` files.

### Seed 4 — Rate limit configs

This seed boots the full NestJS AppModule and calls `initializeRateLimitConfigs()`. It requires all production env vars to be present locally (via the `src/config/.env.prod` file created in the prerequisites).

```bash
cd ats-fit-backend
NODE_ENV=production npm run seed:rate-limits
```

Expected output:
```
Starting rate limit configuration seeding...
Rate limit configurations seeded successfully!
```

**Verify:** Hit a rate-limited endpoint (e.g. resume generation) and confirm the `X-RateLimit-*` headers are present in the response.

### Post-seeding cleanup

After all seeds succeed:
```bash
# Remove the local prod env file — its values are now stored in Railway
rm src/config/.env.prod
```

Never commit `src/config/.env.prod`. Confirm it stays out of git:
```bash
git status src/config/   # should show nothing
```

## Open items / decide later

- Sentry / log shipping: not in scope now.
- Backups for Postgres: Railway has automated backups on Pro plan — verify enabled.
- Rate limiting at ingress: NestJS-level for now.
- Cloudflare proxy in front of Railway (CDN/WAF): defer until cert issuance is stable.
- Add idempotency to `seedResumeTemplates` (check by `key` column before inserting) — prevents duplicate records if seed is re-run after adding new templates.
