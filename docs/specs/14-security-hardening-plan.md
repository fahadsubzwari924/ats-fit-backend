# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 41 prioritized findings from the November 2026 backend security audit, bringing `ats-fit-backend` to OWASP ASVS L2 and SOC 2 Type I readiness.

**Architecture:** Five sequential phases, each independently shippable. Each phase is implemented end-to-end, then we **stop and wait for the user to request the PR**. No automated PR creation — PRs are opened only when the user explicitly asks.

**Tech Stack:** NestJS 11 + TypeORM + Postgres + Bull/Redis + AWS S3/KMS + Helmet + class-validator + bcrypt + jsonwebtoken.

**Plan task schema (per ats-fit-backend contract):** every task carries `path`, `intent`, `verify`, `agency`, `docs`.

---

## Execution rules (read first)

1. **One phase at a time.** Do not start Phase N+1 until the user has merged Phase N's PR.
2. **No unit tests.** Verification is done via manual smoke tests, type-check, lint, and curl/Postman against a running dev server. If a security control needs proof, capture it in a screenshot or a short shell transcript.
3. **PRs are user-gated.** After completing all tasks in a phase, run `git status` + `git log --oneline -- master..HEAD`, summarize what changed, and **stop**. Do not create a PR until the user explicitly says "create the PR" / "open the PR".
4. **Commits are per-task.** Every task ends with a focused commit so revert is surgical if anything breaks.
5. **Branch naming.** One branch per phase: `security/phase-1-stop-the-bleed`, `security/phase-2-edge-hardening`, etc.

---

## Phase 0 — Pre-flight (one-time, before Phase 1)

### Task 0.1: Snapshot baseline and confirm green build

- **path:** repo root
- **intent:** Capture today's dependency-vuln fingerprint and confirm `master` is green before any change.
- **verify:** `npm run lint && npm run build` exits 0; `docs/specs/_security-baseline-audit.json` is committed.
- **agency:** `subagentType="DevOps Automator"` / `cursorRule="@agency-devops-automator.mdc"`
- **docs:** `.ai/workflow.md`, `docs/CONVENTIONS.md`

- [ ] **Step 1: Confirm working tree clean and on master**

```bash
git checkout master && git pull --ff-only && git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Snapshot the audit baseline**

```bash
npm audit --omit=dev --json > docs/specs/_security-baseline-audit.json
git add docs/specs/_security-baseline-audit.json
git commit -m "chore(security): snapshot dependency audit baseline"
```

- [ ] **Step 3: Build + lint sanity check**

```bash
npm run lint && npm run build
```

Expected: exit 0 on both.

- [ ] **Step 4: Stop and await user signal to begin Phase 1.**

---

## Phase 1 — Stop the Bleed

**Branch:** `security/phase-1-stop-the-bleed`

**Scope:** Eliminate the four findings a stranger could exploit today — forgeable webhook, MIME spoofing on resume upload, vulnerable dependencies, plaintext DB/Redis connections — plus add multer-level body-size caps.

### Task 1.1: Harden webhook signature verification (Critical C1)

- **path:** `src/modules/subscription/services/subscription.service.ts:495-524`, `src/config/validation.schema.ts:65`
- **intent:** Refuse webhook calls that lack a signature or arrive when the secret is unconfigured, regardless of `NODE_ENV`. Use constant-time hex comparison handling length mismatch deterministically.
- **verify:** `curl -X POST http://localhost:3000/api/v1/subscriptions/payment-confirmation -H 'Content-Type: application/json' -d '{}'` → 400 with `Invalid signature`. With a valid signature header, returns 200.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/API-PATTERNS.md`, `src/modules/subscription/controllers/subscription.controller.ts:594-625`

- [ ] **Step 1: Cut Phase 1 branch**

```bash
git checkout -b security/phase-1-stop-the-bleed
```

- [ ] **Step 2: Replace `verifySignature` body**

Edit `src/modules/subscription/services/subscription.service.ts:498-524`:

```ts
async verifySignature(signature: string, payload: string): Promise<boolean> {
  if (!signature || typeof signature !== 'string') {
    this.logger.warn('Webhook rejected: missing or non-string signature');
    return false;
  }

  const secret = this.configService.get<string>('LEMON_SQUEEZY_WEBHOOK_SECRET');
  if (!secret) {
    this.logger.error('Webhook rejected: LEMON_SQUEEZY_WEBHOOK_SECRET is not configured');
    return false;
  }

  try {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const provided = signature.toLowerCase().trim();
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch (error) {
    this.logger.error('Failed to verify webhook signature', error);
    return false;
  }
}
```

- [ ] **Step 3: Tighten the Joi env schema**

Edit `src/config/validation.schema.ts:65`:

```ts
LEMON_SQUEEZY_WEBHOOK_SECRET: Joi.string()
  .min(20)
  .when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().min(20).optional() }),
```

- [ ] **Step 4: Smoke test**

Start the dev server (`npm run start:dev`), then:

```bash
# Should be rejected:
curl -i -X POST http://localhost:3000/api/v1/subscriptions/payment-confirmation \
  -H 'Content-Type: application/json' -d '{"meta":{"custom_data":{"email":"e@e.com","plan_id":"1"}}}'
# Expected: HTTP 400 with "Invalid signature"
```

Then craft a valid signature using the secret and re-call; expect 200 (or 404 user-not-found, but NOT 400 invalid-signature).

- [ ] **Step 5: Commit**

```bash
git add src/modules/subscription/services/subscription.service.ts src/config/validation.schema.ts
git commit -m "fix(security): reject unsigned webhooks and missing secret (C1)"
```

---

### Task 1.2: Magic-byte MIME verification + sanitized S3 keys (Critical C2 + C3)

- **path:** `src/shared/pipes/file-validation.pipe.ts`, `src/shared/utils/filename-sanitize.util.ts` (create), `src/modules/resume-tailoring/services/resume.service.ts:107-123`, `src/modules/user/services/replace-resume.service.ts:210-220`
- **intent:** Reject files whose magic bytes do not match the declared MIME. Replace user-controlled `originalname` with a deterministic key `{userId}/{uuid}.pdf` and a sanitized display name.
- **verify:** `curl -F 'resumeFile=@some.png;type=application/pdf'` to `/api/v1/users/upload-resume` returns 400 `UNSUPPORTED_FILE_TYPE`. A real PDF returns 201. S3 key in DB matches `userId/uuid.pdf`.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/SECURITY.md`, `src/shared/constants/mime-types.enum.ts`, `src/shared/constants/resume-replacement.constants.ts`

- [ ] **Step 1: Install file-type**

```bash
npm install file-type@16.5.4
```

(v16 stays CommonJS-compatible with the current Nest CJS build; v19+ is ESM-only.)

- [ ] **Step 2: Create the sanitizer util**

Create `src/shared/utils/filename-sanitize.util.ts`:

```ts
import { randomUUID } from 'crypto';

const MAX_LEN = 100;
const SAFE = /[^a-zA-Z0-9._-]/g;

export function sanitizeFilename(input: string): string {
  if (!input || typeof input !== 'string') return 'file';
  const noControl = input.replace(/[\x00-\x1f\x7f]/g, '');
  const basename = noControl.split(/[\\/]/).pop() ?? 'file';
  const safe = basename.normalize('NFKC').replace(SAFE, '');
  return safe.slice(0, MAX_LEN) || 'file';
}

export function buildResumeS3Key(userId: string, ext: 'pdf' | 'docx'): string {
  return `${userId}/${randomUUID()}.${ext}`;
}
```

- [ ] **Step 3: Rewrite `FileValidationPipe` to be async + magic-byte aware**

Replace `src/shared/pipes/file-validation.pipe.ts` entirely:

```ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import FileType from 'file-type';
import { ERROR_CODES } from '../constants/error-codes';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf']);

@Injectable()
export class FileValidationPipe implements PipeTransform<Express.Multer.File | undefined> {
  async transform(file?: Express.Multer.File): Promise<Express.Multer.File | undefined> {
    if (!file) return undefined;
    if (!file.buffer?.length) {
      throw new BadRequestException('Resume file is empty or corrupted', ERROR_CODES.BAD_REQUEST);
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${MAX_BYTES / 1024 / 1024}MB`,
        ERROR_CODES.BAD_REQUEST,
      );
    }
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException('Only PDF files are supported for resume upload', ERROR_CODES.UNSUPPORTED_FILE_TYPE);
    }
    const detected = await FileType.fromBuffer(file.buffer);
    if (!detected || detected.mime !== file.mimetype) {
      throw new BadRequestException('File MIME mismatch: declared type does not match content', ERROR_CODES.UNSUPPORTED_FILE_TYPE);
    }
    return file;
  }
}
```

- [ ] **Step 4: Use sanitized key + name in `ResumeService.uploadUserResume`**

Edit `src/modules/resume-tailoring/services/resume.service.ts:107-123`:

```ts
import { sanitizeFilename, buildResumeS3Key } from '../../../shared/utils/filename-sanitize.util';
// ...
const safeName = sanitizeFilename(resumeFile.originalname);
const s3Key = buildResumeS3Key(userId, 'pdf');
const s3Url = await this.uploadToS3(resumeFile, s3Key);

const resume = this.resumeRepository.create({
  fileName: safeName,
  fileSize: resumeFile.size,
  mimeType: resumeFile.mimetype,
  s3Url,
  user,
});
```

- [ ] **Step 5: Apply the same in `ReplaceResumeService`**

Edit `src/modules/user/services/replace-resume.service.ts:210-220` to use `buildResumeS3Key(userId, 'pdf')` for the S3 key and `sanitizeFilename(ctx.file.originalname)` for `fileName`.

- [ ] **Step 6: Smoke test**

Start dev server. Try three uploads:

```bash
TOKEN=...your jwt...

# Real PDF — expect 201
curl -i -F "resumeFile=@./sample-resume.pdf" -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/users/upload-resume

# PNG renamed to .pdf with fake content-type — expect 400 UNSUPPORTED_FILE_TYPE
cp sample.png fake.pdf
curl -i -F "resumeFile=@./fake.pdf;type=application/pdf" -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/users/upload-resume

# Path-traversal filename — expect 201 BUT inspect DB row fileName has been stripped
mv sample-resume.pdf "../../etc.pdf"
curl -i -F "resumeFile=@../../etc.pdf;type=application/pdf" -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/users/upload-resume
psql ats_fit -c "SELECT \"fileName\", \"s3Url\" FROM user_resumes ORDER BY \"createdAt\" DESC LIMIT 1;"
# Expected: fileName has no slashes; s3Url path is userId/uuid.pdf
```

- [ ] **Step 7: Lint + build**

```bash
npm run lint && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json \
        src/shared/pipes/file-validation.pipe.ts \
        src/shared/utils/filename-sanitize.util.ts \
        src/modules/resume-tailoring/services/resume.service.ts \
        src/modules/user/services/replace-resume.service.ts
git commit -m "fix(security): magic-byte MIME check + sanitized S3 keys (C2/C3)"
```

---

### Task 1.3: Multer + JSON body size limits (High H8)

- **path:** `src/main.ts`, every controller using `FileInterceptor`
- **intent:** Stop the parser from buffering more than 5 MB into memory; cap JSON bodies at 256 KB.
- **verify:** `curl -F 'resumeFile=@10mb.bin' .../upload-resume` returns 413 before controller code runs.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md`, `docs/SECURITY.md`

- [ ] **Step 1: Inventory `FileInterceptor` call sites**

```bash
grep -rn "FileInterceptor(" src --include='*.ts'
```

Capture all hits (expect `user.controller.ts:247` and `:348` at minimum).

- [ ] **Step 2: Add explicit limits at every call site**

Pattern:

```ts
@UseInterceptors(
  FileInterceptor('resumeFile', {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  }),
)
```

Use the matching field name (`'resumeFile'`, `'file'`, …) per existing call site.

- [ ] **Step 3: Add JSON body cap in `main.ts`**

Edit `src/main.ts` immediately after `NestFactory.create`:

```ts
import { json, urlencoded } from 'express';
app.use(json({ limit: '256kb' }));
app.use(urlencoded({ limit: '256kb', extended: true }));
```

(Webhooks still work — Nest's `rawBody: true` is processed separately.)

- [ ] **Step 4: Smoke test**

```bash
dd if=/dev/urandom of=big.pdf bs=1m count=10
curl -i -F "resumeFile=@./big.pdf;type=application/pdf" -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/users/upload-resume
# Expected: HTTP 413
```

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/modules/user/user.controller.ts
git commit -m "fix(security): multer + json body size limits (H8)"
```

---

### Task 1.4: Patch high/critical CVEs and add CI audit gate (Critical C4)

- **path:** `package.json`, `package-lock.json`, optional `.github/workflows/security.yml`
- **intent:** Resolve all 11 high + critical CVEs flagged by `npm audit --omit=dev`. Prevent regression with a CI gate.
- **verify:** `npm audit --omit=dev --audit-level=high` exits 0; app boots and a smoke run of upload + signin works.
- **agency:** `subagentType="DevOps Automator"` / `cursorRule="@agency-devops-automator.mdc"`
- **docs:** `docs/specs/_security-baseline-audit.json`, `package.json`

- [ ] **Step 1: Attempt non-breaking fix**

```bash
npm audit fix
npm run build
```

If build passes, run smoke tests (Phase-1 endpoints) before continuing.

- [ ] **Step 2: For unresolved transitive criticals, add overrides**

If `basic-ftp` / `fast-xml-parser` / `qs` deep transitives remain, edit `package.json`:

```json
"overrides": {
  "axios": "^1.7.9",
  "path-to-regexp": "^8.3.1",
  "fast-xml-parser": "^4.5.1",
  "basic-ftp": "^5.0.5",
  "qs": "^6.13.0"
}
```

Then:

```bash
rm -rf node_modules package-lock.json && npm install && npm run build
```

- [ ] **Step 3: Re-snapshot audit**

```bash
npm audit --omit=dev --json > docs/specs/_security-baseline-audit.json
npm audit --omit=dev --audit-level=high
# Expected: 0 vulnerabilities at high or critical level
```

- [ ] **Step 4: Add CI gate (optional, only if GitHub Actions in use)**

Create `.github/workflows/security.yml`:

```yaml
name: security-audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci --omit=dev
      - run: npm audit --omit=dev --audit-level=high
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json docs/specs/_security-baseline-audit.json .github/workflows/security.yml
git commit -m "chore(security): patch high/critical CVEs + CI audit gate (C4)"
```

---

### Task 1.5: Enforce TLS for Postgres and Redis in production (Critical C5)

- **path:** `src/config/validation.schema.ts`, `src/database/database.module.ts`, `src/database/data-source.ts`, `src/app.module.ts:36-56`
- **intent:** Refuse plaintext connections in production. Allow override flag for dev.
- **verify:** `NODE_ENV=production DATABASE_SSL=false npm run start` exits with a clear Joi error. With `DATABASE_SSL=true` against Railway's Postgres URL, app boots.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/ARCHITECTURE.md`, `RAILWAY_DEPLOYMENT_PLAN.md`, `.ai/rules.md`

- [ ] **Step 1: Extend Joi schema**

Add to `src/config/validation.schema.ts`:

```ts
DATABASE_SSL: Joi.boolean().default(true),
DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
REDIS_TLS: Joi.boolean().default(false),
```

Then append a `.custom(...)` block that fails when `NODE_ENV === 'production' && DATABASE_SSL !== true`.

- [ ] **Step 2: Wire ssl into Postgres connection**

Edit `src/database/database.module.ts:30-77`:

```ts
const useSsl = configService.get<boolean>('DATABASE_SSL');
return {
  type: 'postgres' as const,
  ...connectionConfig,
  ssl: useSsl ? { rejectUnauthorized: configService.get<boolean>('DATABASE_SSL_REJECT_UNAUTHORIZED') } : false,
  // ... rest unchanged
};
```

Mirror the same `ssl` block in `src/database/data-source.ts` (used by the migration CLI).

- [ ] **Step 3: Wire tls into BullModule Redis**

Edit `src/app.module.ts:36-56`:

```ts
redis: {
  host: configService.get<string>('REDIS_HOST', 'localhost'),
  port: configService.get<number>('REDIS_PORT', 6379),
  password: configService.get<string>('REDIS_PASSWORD') || undefined,
  db: configService.get<number>('REDIS_DB', 0),
  tls: configService.get<boolean>('REDIS_TLS') ? {} : undefined,
},
```

- [ ] **Step 4: Smoke test the fail-closed path**

```bash
NODE_ENV=production DATABASE_SSL=false npm run start
# Expected: process exits with Joi error mentioning DATABASE_SSL
```

- [ ] **Step 5: Commit**

```bash
git add src/config/validation.schema.ts src/database/database.module.ts src/database/data-source.ts src/app.module.ts
git commit -m "fix(security): enforce TLS for Postgres and Redis in prod (C5)"
```

---

### Phase 1 close-out (do NOT open PR yet)

- [ ] **Step 1: Confirm branch is clean**

```bash
git status
git log --oneline master..HEAD
```

- [ ] **Step 2: Summarize the phase**

Write a 5–10 line summary listing the five commits, findings closed (C1, C2, C3, C4, C5, H8), and any open follow-ups.

- [ ] **Step 3: Stop and wait for user signal.**

> When the user says "create the PR for phase 1", run the `gh pr create` flow (title: `security: phase 1 — stop the bleed`, body: paste the summary, link this plan). Do not run `gh pr create` before that.

---

## Phase 2 — Request-edge hardening

**Branch:** `security/phase-2-edge-hardening` (cut from master AFTER Phase 1 PR is merged).

**Scope:** Safe headers on every response, sanitized error responses, Swagger gated to non-prod, OAuth payload redaction, CORS hardened against wildcard-with-credentials.

### Task 2.1: Install and configure Helmet (High H1)

- **path:** `src/main.ts`
- **intent:** Set HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options on every response.
- **verify:** `curl -sI http://localhost:3000/api/v1/health` shows `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1: Cut Phase 2 branch from master**

```bash
git checkout master && git pull --ff-only
git checkout -b security/phase-2-edge-hardening
```

- [ ] **Step 2: Install helmet**

```bash
npm install helmet@^8
```

- [ ] **Step 3: Wire helmet in `main.ts`**

Before `app.enableCors(...)`:

```ts
import helmet from 'helmet';
app.use(
  helmet({
    contentSecurityPolicy: false, // API only — frontend ships its own CSP
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
```

- [ ] **Step 4: Smoke test headers**

```bash
npm run start:dev &
sleep 5
curl -sI http://localhost:3000/api/v1/health | grep -iE 'strict-transport|x-content|x-frame|referrer'
```

Expected: all four headers present. Capture transcript.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main.ts
git commit -m "feat(security): enable helmet with HSTS + frame deny (H1)"
```

---

### Task 2.2: Gate Swagger to non-production (High H2)

- **path:** `src/main.ts:83-93`
- **intent:** Don't mount Swagger UI/OpenAPI JSON in production.
- **verify:** `NODE_ENV=production` → `GET /api/docs` returns 404. `NODE_ENV=development` → 200.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/SECURITY.md`

- [ ] **Step 1: Wrap Swagger setup in an env guard**

Edit `src/main.ts:83-93`:

```ts
if (process.env.NODE_ENV !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('ATS Fit API')
    .setDescription('API documentation for ATS Fit Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
```

- [ ] **Step 2: Smoke test both modes**

```bash
NODE_ENV=production npm run start &
sleep 5
curl -sI http://localhost:3000/api/docs | head -1   # → HTTP/1.1 404

NODE_ENV=development npm run start:dev &
sleep 5
curl -sI http://localhost:3000/api/docs | head -1   # → HTTP/1.1 200
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix(security): gate Swagger UI to non-production (H2)"
```

---

### Task 2.3: Sanitize production error responses (High H3)

- **path:** `src/main.ts:99-117`, `src/shared/modules/response/exception.filter.ts:81-83`
- **intent:** In production, never echo raw `exception.message` for non-HttpException errors; strip validation `errors` payload of class-validator constraint detail.
- **verify:** Force an internal error in prod mode (e.g. throw a generic Error in a test route) and confirm response says `Internal server error` with no stack trace and no `originalError` field. In dev mode behavior unchanged.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/ERROR-HANDLING.md`, `docs/SECURITY.md`

- [ ] **Step 1: Patch the exception filter**

Edit `src/shared/modules/response/exception.filter.ts:81-83`:

```ts
} else if (exception instanceof Error) {
  const isProd = process.env.NODE_ENV === 'production';
  // eslint-disable-next-line no-console
  console.error('[AllExceptionsFilter] unhandled', {
    name: exception.name,
    message: exception.message,
    stack: exception.stack,
  });
  message = isProd ? 'Internal server error' : exception.message;
  code = ERROR_CODES.INTERNAL_SERVER;
}
```

- [ ] **Step 2: Tighten the global ValidationPipe**

Edit `src/main.ts:99-117`:

```ts
const isProd = process.env.NODE_ENV === 'production';
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    enableDebugMessages: !isProd,
    disableErrorMessages: isProd,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Validation failed',
        errors: errors.map((e) => ({ field: e.property })),
      }),
  }),
);
```

- [ ] **Step 3: Smoke test**

Send an invalid signup payload in prod mode:

```bash
NODE_ENV=production npm run start &
sleep 5
curl -i -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
# Expected: 400, errors array has { field: "email" } only, no constraint detail
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/shared/modules/response/exception.filter.ts
git commit -m "fix(security): sanitize prod error responses (H3)"
```

---

### Task 2.4: Redact Google token-payload logs (High H4)

- **path:** `src/shared/modules/external/services/google.service.ts:37`
- **intent:** Stop logging entire OAuth payload (email, name, picture, hosted-domain).
- **verify:** Sign in with Google and grep dev-server stdout — `Google token payload` substring must not appear. New log line shows `sub=` only.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/SECURITY.md`

- [ ] **Step 1: Replace line 37**

```ts
this.logger.log(`Google token verified for sub=${payload?.sub ?? 'unknown'}`);
```

- [ ] **Step 2: Smoke test**

Sign in via the local frontend; tail the logs and confirm no PII appears.

- [ ] **Step 3: Commit**

```bash
git add src/shared/modules/external/services/google.service.ts
git commit -m "fix(security): redact Google OAuth payload from logs (H4)"
```

---

### Task 2.5: CORS hardening (Medium M1)

- **path:** `src/main.ts:36-79`, `src/config/validation.schema.ts:42`
- **intent:** Refuse `CORS_ORIGIN='*'` when `credentials: true`. Support a comma-separated allowlist.
- **verify:** App refuses to boot with `CORS_ORIGIN='*'` in production. Multi-origin allowlist works in dev (Postman/curl with `Origin: https://app.tairly.com` succeeds; unknown origin fails preflight).
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1: Tighten Joi**

Edit `src/config/validation.schema.ts:42`:

```ts
CORS_ORIGIN: Joi.string()
  .pattern(/^https?:\/\/[^\s,]+(,https?:\/\/[^\s,]+)*$/)
  .default('http://localhost:4200'),
```

- [ ] **Step 2: Allowlist origin in `main.ts`**

Edit `src/main.ts:36-79`:

```ts
const allowlist = (process.env.CORS_ORIGIN ?? 'http://localhost:4200')
  .split(',')
  .map((s) => s.trim());

app.enableCors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    return cb(null, allowlist.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [/* existing array, unchanged */],
  exposedHeaders: [/* existing array, unchanged */],
});
```

- [ ] **Step 3: Smoke test**

```bash
# Unknown origin — preflight should not include Access-Control-Allow-Origin
curl -i -X OPTIONS http://localhost:3000/api/v1/users/me \
  -H 'Origin: https://evil.example.com' -H 'Access-Control-Request-Method: GET'

# Allowed origin
curl -i -X OPTIONS http://localhost:3000/api/v1/users/me \
  -H 'Origin: http://localhost:4200' -H 'Access-Control-Request-Method: GET'
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/config/validation.schema.ts
git commit -m "fix(security): CORS allowlist + reject wildcard with credentials (M1)"
```

---

### Phase 2 close-out (do NOT open PR yet)

- [ ] **Step 1: Confirm branch is clean**

```bash
git status
git log --oneline master..HEAD
```

- [ ] **Step 2: Smoke-test consolidated**

Hit `/api/v1/health`, `/api/v1/auth/signin`, `/api/docs` in both `NODE_ENV=production` and `NODE_ENV=development`. Capture headers + status codes.

- [ ] **Step 3: Summarize and stop.**

> When user says "create the PR for phase 2", run `gh pr create` with title `security: phase 2 — request-edge hardening` and the captured smoke evidence in the body.

---

## Phase 3 — Resume upload re-architecture

**Branch:** `security/phase-3-upload-rearchitecture` (cut after Phase 2 PR merged).

**Scope:** Bytes move browser-to-S3 via short-lived presigned PUT URLs. Backend never holds file in RAM. SSE-KMS is non-bypassable. All reads through short-lived signed-GET. Bucket goes private with Block-Public-Access.

> This phase requires AWS-side prep before code: create a customer-managed KMS key `ats-fit/resumes`, grant the API role `kms:GenerateDataKey` + `kms:Decrypt`, set `AWS_KMS_KEY_ID` env in Railway. Do this manually first.

### Task 3.1: Schema + entity columns for upload lifecycle

- **path:** new migration `src/database/migrations/<ts>-AddUploadStatusToUserResumes.ts`, `src/database/entities/resume.entity.ts`, `src/config/validation.schema.ts` (add `AWS_KMS_KEY_ID`)
- **intent:** Add `s3_key`, `upload_status` (`pending_scan` / `ready` / `quarantined` / `failed`) to `user_resumes`. Make `AWS_KMS_KEY_ID` required in production.
- **verify:** `npm run migration:run` succeeds; `\d user_resumes` shows new columns; app fails to start in prod without `AWS_KMS_KEY_ID`.
- **agency:** `subagentType="Database Optimizer"` / `cursorRule="@agency-database-optimizer.mdc"`
- **docs:** `docs/specs/01-architecture.md`, `docs/SECURITY.md`

- [ ] **Step 1: Cut Phase 3 branch**

```bash
git checkout master && git pull --ff-only
git checkout -b security/phase-3-upload-rearchitecture
```

- [ ] **Step 2: Generate the migration**

```bash
npx ts-node ./node_modules/typeorm/cli.js migration:create src/database/migrations/AddUploadStatusToUserResumes
```

Fill in:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUploadStatusToUserResumes<<TS>> implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "resume_upload_status" AS ENUM ('pending_scan','ready','quarantined','failed')`);
    await q.query(`ALTER TABLE "user_resumes" ADD COLUMN "s3_key" varchar(512) NULL`);
    await q.query(`ALTER TABLE "user_resumes" ADD COLUMN "upload_status" "resume_upload_status" NOT NULL DEFAULT 'ready'`);
    await q.query(`CREATE UNIQUE INDEX "uq_user_resumes_s3_key" ON "user_resumes" ("s3_key")`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "uq_user_resumes_s3_key"`);
    await q.query(`ALTER TABLE "user_resumes" DROP COLUMN "upload_status"`);
    await q.query(`ALTER TABLE "user_resumes" DROP COLUMN "s3_key"`);
    await q.query(`DROP TYPE "resume_upload_status"`);
  }
}
```

- [ ] **Step 3: Add columns to `Resume` entity**

Edit `src/database/entities/resume.entity.ts`:

```ts
@Column({ name: 's3_key', type: 'varchar', length: 512, nullable: true })
s3Key: string | null;

@Column({ name: 'upload_status', type: 'enum', enum: ['pending_scan','ready','quarantined','failed'], default: 'ready' })
uploadStatus: 'pending_scan' | 'ready' | 'quarantined' | 'failed';
```

- [ ] **Step 4: Add KMS key to env schema**

`src/config/validation.schema.ts`:

```ts
AWS_KMS_KEY_ID: Joi.when('NODE_ENV', { is: 'production', then: Joi.string().required(), otherwise: Joi.string().optional() }),
```

- [ ] **Step 5: Run migration locally**

```bash
npm run migration:run
psql ats_fit -c "\d user_resumes"
```

- [ ] **Step 6: Commit**

```bash
git add src/database/migrations/*-AddUploadStatusToUserResumes.ts \
        src/database/entities/resume.entity.ts \
        src/config/validation.schema.ts
git commit -m "feat(security): upload-status schema for direct-to-S3 flow"
```

---

### Task 3.2: Presigned-PUT initiate endpoint (High H5 + H6)

- **path:** `src/shared/modules/external/services/s3.service.ts`, `src/modules/user/services/upload-initiation.service.ts` (create), `src/modules/user/dtos/initiate-upload.dto.ts` (create), `src/modules/user/user.controller.ts`, `src/modules/user/user.module.ts`
- **intent:** `POST /users/uploads/initiate` returns a 5-min presigned PUT URL with `x-amz-server-side-encryption: aws:kms` baked in. Backend never receives the file.
- **verify:** Call endpoint with valid JWT, capture URL and required headers, run `curl -X PUT $url -H 'Content-Type: application/pdf' -H 'x-amz-server-side-encryption: aws:kms' --data-binary @resume.pdf`. AWS console shows the object exists with SSE-KMS encryption. Row in `user_resumes` has `upload_status='pending_scan'`.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/ARCHITECTURE.md`, `docs/API-PATTERNS.md`, `docs/SECURITY.md`

- [ ] **Step 1: Extend `S3Service`**

Add to `src/shared/modules/external/services/s3.service.ts`:

```ts
async getPresignedPutUrl(params: {
  bucketName: string;
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<{ url: string; requiredHeaders: Record<string, string> }> {
  const { bucketName, key, contentType, expiresIn = 300 } = params;
  const kmsKey = this.configService.get<string>('AWS_KMS_KEY_ID');
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: kmsKey,
  });
  const url = await getSignedUrl(this.s3Client, command, {
    expiresIn,
    unhoistableHeaders: new Set([
      'x-amz-server-side-encryption',
      'x-amz-server-side-encryption-aws-kms-key-id',
    ]),
  });
  const requiredHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'x-amz-server-side-encryption': 'aws:kms',
  };
  if (kmsKey) requiredHeaders['x-amz-server-side-encryption-aws-kms-key-id'] = kmsKey;
  return { url, requiredHeaders };
}
```

- [ ] **Step 2: Create the DTO**

`src/modules/user/dtos/initiate-upload.dto.ts`:

```ts
import { IsIn } from 'class-validator';
export class InitiateUploadDto {
  @IsIn(['application/pdf'])
  mimeType: 'application/pdf';
}
```

- [ ] **Step 3: Create `UploadInitiationService`**

`src/modules/user/services/upload-initiation.service.ts`:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resume } from '../../../database/entities/resume.entity';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { buildResumeS3Key } from '../../../shared/utils/filename-sanitize.util';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@Injectable()
export class UploadInitiationService {
  private readonly bucket: string;
  constructor(
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
  ) {
    this.bucket = this.config.get<string>('AWS_S3_CANDIDATES_RESUMES_BUCKET')!;
  }

  async initiate(userId: string, declaredMime: string) {
    if (declaredMime !== 'application/pdf') {
      throw new BadRequestException('Only application/pdf is supported', ERROR_CODES.UNSUPPORTED_FILE_TYPE);
    }
    const key = buildResumeS3Key(userId, 'pdf');
    const { url, requiredHeaders } = await this.s3.getPresignedPutUrl({
      bucketName: this.bucket,
      key,
      contentType: 'application/pdf',
    });
    const resume = await this.resumes.save(this.resumes.create({
      fileName: 'pending',
      fileSize: 0,
      mimeType: 'application/pdf',
      s3Key: key,
      s3Url: '',
      uploadStatus: 'pending_scan',
      isActive: false,
      user: { id: userId } as never,
    }));
    return { uploadUrl: url, key, requiredHeaders, resumeId: resume.id, expiresInSeconds: 300 };
  }
}
```

- [ ] **Step 4: Add the controller route**

In `src/modules/user/user.controller.ts`:

```ts
@Post('uploads/initiate')
@ApiOperation({ summary: 'Get a presigned URL to upload a resume directly to S3' })
async initiateUpload(@Body() dto: InitiateUploadDto, @Req() req: RequestWithUserContext) {
  return this.uploadInitiationService.initiate(req.userContext!.userId, dto.mimeType);
}
```

Register `UploadInitiationService` in `user.module.ts` providers.

- [ ] **Step 5: Smoke test**

```bash
RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/users/uploads/initiate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mimeType":"application/pdf"}')
echo $RESPONSE | jq

URL=$(echo $RESPONSE | jq -r .uploadUrl)
curl -i -X PUT "$URL" \
  -H 'Content-Type: application/pdf' \
  -H 'x-amz-server-side-encryption: aws:kms' \
  --data-binary @sample-resume.pdf
# Expected: HTTP 200

# Inspect in AWS console: object exists, Encryption = SSE-KMS, key = <userId>/<uuid>.pdf
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/modules/external/services/s3.service.ts \
        src/modules/user/services/upload-initiation.service.ts \
        src/modules/user/dtos/initiate-upload.dto.ts \
        src/modules/user/user.controller.ts \
        src/modules/user/user.module.ts
git commit -m "feat(security): presigned-PUT upload initiation with SSE-KMS (H5/H6)"
```

---

### Task 3.3: Post-upload confirm + magic-byte gate

- **path:** `src/shared/utils/pdf-magic-bytes.util.ts` (create), `src/modules/user/services/upload-confirmation.service.ts` (create), `src/modules/user/dtos/confirm-upload.dto.ts` (create), `src/modules/user/user.controller.ts`, `src/shared/modules/external/services/s3.service.ts` (add `getObjectRange`)
- **intent:** Client calls `POST /users/uploads/confirm` after the PUT succeeds. Backend reads first 8 bytes from S3, asserts `%PDF-`, then enqueues a scan job (or flips to `ready` immediately if scan not yet wired). Mismatch → delete the object + mark `quarantined`.
- **verify:** Confirm with a real PDF → row flips to `ready`. Upload PNG via the presigned URL then call confirm → row goes to `quarantined`, S3 object deleted, response 400.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/ARCHITECTURE.md`, `docs/SECURITY.md`

- [ ] **Step 1: Build magic-byte util**

`src/shared/utils/pdf-magic-bytes.util.ts`:

```ts
export function isPdfBuffer(head: Buffer): boolean {
  if (head.length < 5) return false;
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}
```

- [ ] **Step 2: Add `getObjectRange` to `S3Service`**

```ts
async getObjectRange(params: { bucketName: string; key: string; range: string }): Promise<Buffer> {
  const cmd = new GetObjectCommand({ Bucket: params.bucketName, Key: params.key, Range: params.range });
  const resp = await this.s3Client.send(cmd);
  const stream = resp.Body as Readable;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
```

- [ ] **Step 3: Create `UploadConfirmationService`**

`src/modules/user/services/upload-confirmation.service.ts`:

```ts
@Injectable()
export class UploadConfirmationService {
  private readonly bucket: string;
  constructor(
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
  ) {
    this.bucket = this.config.get<string>('AWS_S3_CANDIDATES_RESUMES_BUCKET')!;
  }

  async confirm(userId: string, resumeId: string) {
    const resume = await this.resumes.findOne({
      where: { id: resumeId, user: { id: userId } },
      relations: ['user'],
    });
    if (!resume || !resume.s3Key) {
      throw new NotFoundException('Upload not found', ERROR_CODES.RESUME_NOT_FOUND);
    }
    const head = await this.s3.getObjectRange({ bucketName: this.bucket, key: resume.s3Key, range: 'bytes=0-7' });
    if (!isPdfBuffer(head)) {
      await this.s3.deleteObject({ bucketName: this.bucket, key: resume.s3Key });
      resume.uploadStatus = 'quarantined';
      resume.isActive = false;
      await this.resumes.save(resume);
      throw new BadRequestException('File is not a valid PDF', ERROR_CODES.UNSUPPORTED_FILE_TYPE);
    }
    // TODO Phase 3.4: enqueue scan job; for now mark ready immediately.
    resume.uploadStatus = 'ready';
    resume.isActive = true;
    await this.resumes.save(resume);
    return { resumeId: resume.id, status: 'ready' as const };
  }
}
```

- [ ] **Step 4: Add controller route + DTO**

`src/modules/user/dtos/confirm-upload.dto.ts`:

```ts
import { IsUUID } from 'class-validator';
export class ConfirmUploadDto { @IsUUID() resumeId: string; }
```

`user.controller.ts`:

```ts
@Post('uploads/confirm')
async confirmUpload(@Body() dto: ConfirmUploadDto, @Req() req: RequestWithUserContext) {
  return this.uploadConfirmationService.confirm(req.userContext!.userId, dto.resumeId);
}
```

Register service in `user.module.ts`.

- [ ] **Step 5: Smoke test**

```bash
# Happy path
RES=$(curl -s -X POST http://localhost:3000/api/v1/users/uploads/initiate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mimeType":"application/pdf"}')
URL=$(echo $RES | jq -r .uploadUrl)
RID=$(echo $RES | jq -r .resumeId)
curl -X PUT "$URL" -H 'Content-Type: application/pdf' -H 'x-amz-server-side-encryption: aws:kms' --data-binary @sample-resume.pdf
curl -i -X POST http://localhost:3000/api/v1/users/uploads/confirm \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"resumeId\":\"$RID\"}"
# Expected: 201 { status: 'ready' }

# Negative — PNG through presigned URL
# (repeat with sample.png; confirm should respond 400 and object should be gone in S3)
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/pdf-magic-bytes.util.ts \
        src/shared/modules/external/services/s3.service.ts \
        src/modules/user/services/upload-confirmation.service.ts \
        src/modules/user/dtos/confirm-upload.dto.ts \
        src/modules/user/user.controller.ts \
        src/modules/user/user.module.ts
git commit -m "feat(security): upload confirm + magic-byte gate"
```

---

### Task 3.4: All reads via signed-GET; bucket goes private

- **path:** every site returning `s3Url`; `RAILWAY_DEPLOYMENT_PLAN.md`
- **intent:** Stop persisting/returning raw HTTPS S3 URLs; every read goes through `S3Service.getSignedUrl({ expiresIn: 300 })`. Enable Block Public Access on the bucket.
- **verify:** `curl https://<bucket>.s3.<region>.amazonaws.com/<key>` returns `AccessDenied`. Frontend resume preview works using the returned signed URL.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `RAILWAY_DEPLOYMENT_PLAN.md`

- [ ] **Step 1: Inventory s3Url leak sites**

```bash
grep -rn "s3Url" src --include='*.ts' | grep -v ".spec"
```

- [ ] **Step 2: Replace each return-to-client with signed-GET**

At every call site that returns `s3Url` to the client, replace with:

```ts
const downloadUrl = await this.s3Service.getSignedUrl({
  bucketName: this.bucket,
  key: resume.s3Key ?? this.s3Service.extractS3KeyFromUrl(resume.s3Url),
  expiresIn: 300,
});
return { ...rest, downloadUrl };
```

(Leave the column in DB; just stop emitting raw URL in responses.)

- [ ] **Step 3: Block Public Access on the bucket**

In AWS console → S3 → `ats-fit-candidates-resumes` → Permissions → Block public access → turn ALL four toggles ON. Document the action in `RAILWAY_DEPLOYMENT_PLAN.md`.

- [ ] **Step 4: Smoke test**

```bash
# Verify direct access is denied
curl -i "https://<bucket>.s3.<region>.amazonaws.com/<userId>/<uuid>.pdf"
# Expected: HTTP 403 AccessDenied

# Verify signed read works
SIGNED=$(curl -s "http://localhost:3000/api/v1/users/me" -H "Authorization: Bearer $TOKEN" | jq -r '.uploadedResumes[0].downloadUrl')
curl -I "$SIGNED"
# Expected: HTTP 200
```

- [ ] **Step 5: Commit**

```bash
git add <touched files> RAILWAY_DEPLOYMENT_PLAN.md
git commit -m "feat(security): signed-GET only reads + private bucket (H5/H6)"
```

---

### Phase 3 close-out (do NOT open PR yet)

- [ ] Run the full curl walkthrough one more time end-to-end (initiate → PUT → confirm → fetch download URL).
- [ ] `git status` + `git log --oneline master..HEAD`.
- [ ] Summarize and stop. Wait for user signal to open the PR.

---

## Phase 4 — Identity strengthening

**Branch:** `security/phase-4-identity` (cut after Phase 3 PR merged).

### Task 4.1: JWT `token_version` claim (High H9)

- **path:** migration adding `users.token_version int default 0`, `src/database/entities/user.entity.ts`, `src/modules/auth/auth.service.ts:113-115`, `src/modules/auth/jwt.strategy.ts:55-70`, `src/modules/auth/services/password-reset.service.ts`
- **intent:** Embed `tv` in every JWT. Reject token if `tv !== user.token_version`. Bump on password reset, logout-all, and admin-driven revocation.
- **verify:** Sign in → capture token → `UPDATE users SET token_version = token_version + 1` → retry same token → 401.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/specs/02-auth-and-identity.md`, `docs/SECURITY.md`

- [ ] **Step 1: Cut Phase 4 branch + add migration**

```bash
git checkout master && git pull --ff-only
git checkout -b security/phase-4-identity
```

Migration body:

```ts
await q.query(`ALTER TABLE "users" ADD COLUMN "token_version" integer NOT NULL DEFAULT 0`);
```

- [ ] **Step 2: Add `token_version` to `User` entity and `JwtPayload` interface.**

- [ ] **Step 3: Embed `tv` in `auth.service.ts:113-115`**

```ts
private async generateAccessToken(user: User): Promise<string> {
  return this.jwtService.signAsync({ sub: user.id, email: user.email, tv: user.token_version });
}
```

- [ ] **Step 4: Validate `tv` in `jwt.strategy.ts:55-70`**

```ts
const user = await this.userRepository.findOne({ where: { id: payload.sub, is_active: true }, select: ['id','email','is_active','token_version'] });
if (!user || user.token_version !== payload.tv) {
  throw new UnauthorizedException('Session is no longer valid. Please sign in again.', ERROR_CODES.UNAUTHORIZED);
}
```

- [ ] **Step 5: Bump on password reset**

In `password-reset.service.ts` resetPassword, increment `token_version` alongside the password update.

- [ ] **Step 6: Smoke test**

```bash
# Login, capture token, hit /users/me — 200
# psql ats_fit -c "UPDATE users SET token_version=token_version+1 WHERE email='you@example.com';"
# Same token to /users/me — 401
```

- [ ] **Step 7: Commit**

```bash
git add <touched files>
git commit -m "feat(security): JWT token versioning + revocation (H9)"
```

---

### Task 4.2: DB-backed admin role (High H7)

- **path:** migration adding `users.role enum`, `src/database/entities/user.entity.ts`, `src/modules/beta-access/guards/admin.guard.ts`, seed script for bootstrap admin
- **intent:** Replace env-list admin check with `user.role === 'admin'`. Keep `ADMIN_EMAILS` only as a one-time bootstrap seed.
- **verify:** Non-admin token → 403 on admin endpoints. Promote a user to admin via SQL → 200. Demote → 403 on next request.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/specs/02-auth-and-identity.md`, `docs/specs/12-beta-access.md`

- [ ] Migration: `CREATE TYPE user_role AS ENUM ('user','admin'); ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'user';`
- [ ] Backfill: `UPDATE users SET role='admin' WHERE email = ANY(string_to_array(:admin_emails, ','));`
- [ ] Update `AdminGuard` to fetch user from DB (use `req.userContext.userId`) and check `role === 'admin'`.
- [ ] Smoke test: hit `POST /api/v1/beta/admin/invite` with both roles.
- [ ] Commit `feat(security): DB-backed admin role (H7)`.

---

### Task 4.3: Password hygiene baseline (Medium M5 + M6)

- **path:** `src/modules/auth/dtos/sign-up.dto.ts`, `src/modules/auth/dtos/reset-password.dto.ts`, `src/modules/auth/auth.service.ts:52,349`
- **intent:** Min length 10, ≥ 1 letter + 1 number, reject top-1k common passwords list, bcrypt cost 12.
- **verify:** `password123` returns 400. `tairlySaaS#26` accepted. New user's DB row hash starts with `$2b$12$`.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/SECURITY.md`

- [ ] Replace `@MinLength(8)` with custom validator that runs length ≥ 10 + regex `(?=.*[a-zA-Z])(?=.*\d)` + common-passwords blocklist (embed top-1k as a Set imported from `src/shared/constants/common-passwords.constant.ts`).
- [ ] Bump bcrypt cost: change `bcrypt.hash(password, 10)` → `bcrypt.hash(password, 12)` in both `signUp` and `generateDummyPassword`.
- [ ] Smoke test with weak/strong passwords.
- [ ] Commit `feat(security): password hygiene + bcrypt cost 12 (M5/M6)`.

---

### Task 4.4: Per-IP rate limit on password reset; Redis-backed admin throttle (Medium M3 + M4)

- **path:** `src/modules/auth/services/password-reset.service.ts`, `src/modules/beta-access/guards/admin-invite-throttle.guard.ts`, new `src/shared/services/redis-throttle.service.ts`
- **intent:** Track reset attempts by `(ip)` and `(emailHash, ip)` independently. Move admin-invite throttle into Redis so it survives horizontal scaling.
- **verify:** 11th reset from same IP within an hour → 429. Two simulated workers share counter via Redis (test by running two `npm run start` instances on different ports against same Redis).
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/specs/08-rate-limits-and-usage.md`

- [ ] Build a thin `RedisThrottleService` that wraps `INCR` + `EXPIRE` against a configurable key prefix.
- [ ] Wire into both call sites.
- [ ] Smoke test the limits.
- [ ] Commit `feat(security): Redis-backed throttles for reset + admin invite (M3/M4)`.

---

### Phase 4 close-out

- [ ] `git status` + `git log --oneline master..HEAD`, summarize, stop, wait for user signal.

---

## Phase 5 — Compliance substrate

**Branch:** `security/phase-5-compliance` (cut after Phase 4 PR merged).

### Task 5.1: Security audit log (Medium M8)

- **path:** migration `create_security_audit_log`, `src/database/entities/security-audit-log.entity.ts` (create), `src/shared/services/security-audit.service.ts` (create), hooks in auth controller, admin guard, beta invite service, subscription controller, replace-resume service.
- **intent:** Append-only `security_audit_log` table: `id, occurred_at, actor_user_id, action, target_type, target_id, ip, user_agent, request_id, success, meta jsonb`. No PII in `meta`. 365-day retention.
- **verify:** Sign-in, password-reset, admin-invite, subscription-webhook, resume-replace — each emits exactly one row visible via `SELECT * FROM security_audit_log ORDER BY id DESC LIMIT 20`.
- **agency:** `subagentType="Compliance Auditor"` / `cursorRule="@agency-compliance-auditor.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/specs/02-auth-and-identity.md`

(Subtasks: migration → entity → service → call-site instrumentation → smoke walkthrough → commit.)

---

### Task 5.2: Hash beta invite codes at rest (Low L7)

- **path:** migration adding `code_hash` to `beta_invites`, `src/modules/beta-access/services/beta-invite.service.ts`, `src/modules/beta-access/services/beta-redemption.service.ts`, `src/modules/beta-access/utils/beta-code-hash.util.ts` (create), one-shot backfill script
- **intent:** Store SHA-256 of code, not plaintext. Plaintext appears only once — in create-response + invite email.
- **verify:** New invite: DB row's `code_hash` is 64-char hex; `code` column nullable or empty for new rows. Redeem with raw code still works. Backfill script migrates pending invites.
- **agency:** `subagentType="Security Engineer"` / `cursorRule="@agency-security-engineer.mdc"`
- **docs:** `docs/specs/12-beta-access.md`

---

### Task 5.3: Trim Bull job payloads of raw PII (Medium M10)

- **path:** `src/modules/beta-access/services/beta-invite.service.ts:130-142`, `beta-invite-email.processor.ts`, every other email job emitter
- **intent:** Push `{ inviteId }` only. The processor re-reads the invite + user from DB.
- **verify:** After issuing 3 invites, `redis-cli LRANGE bull:beta-access:waiting 0 -1` reveals no emails or codes.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/specs/12-beta-access.md`

---

### Task 5.4: Column-level encryption for sensitive PII (Medium M7)

- **path:** migration enabling `pgcrypto`; `src/shared/transformers/encrypted-column.transformer.ts` (create); apply to `users.ip_address`, `extracted_resume_content.phone`, `enriched_resume_profile.contact_*`.
- **intent:** Postgres-side envelope encryption using a key derived from AWS KMS data key passed in env. Reads return plaintext within app; raw DB dump leaks ciphertext only.
- **verify:** Insert phone via API; `SELECT phone FROM extracted_resume_content WHERE id=X` returns ciphertext; reading back via API returns plaintext.
- **agency:** `subagentType="Database Optimizer"` / `cursorRule="@agency-database-optimizer.mdc"`
- **docs:** `docs/SECURITY.md`, `docs/ARCHITECTURE.md`

---

### Task 5.5: Soft-delete + retention sweeper for resumes (Medium M9)

- **path:** migration adding `user_resumes.deleted_at`, `src/modules/resume-tailoring/services/resume.service.ts:140-160`, `src/shared/services/archive-purge.service.ts`
- **intent:** Resume delete sets `deleted_at = now()` + `is_active = false`; cron-driven purge after 30 days removes S3 object and DB row, writing a `security_audit_log` row.
- **verify:** Delete resume → row marked, S3 object intact. Manually fast-forward `deleted_at` past retention window + run sweeper → S3 deleted, row gone, audit log present.
- **agency:** `subagentType="Backend Architect"` / `cursorRule="@agency-backend-architect.mdc"`
- **docs:** `docs/specs/03-resume-tailoring.md`

---

### Phase 5 close-out

- [ ] `git status` + `git log --oneline master..HEAD`, summarize, stop, wait for user signal.

---

## Cross-phase deliverables (do after each phase merge)

1. Update `docs/SECURITY.md` to reflect the new posture (replace each TBD with what's actually enforced).
2. Append a phase note to `docs/ARCHITECTURE.md` describing newly introduced components.
3. Re-snapshot `npm audit --omit=dev --json > docs/specs/_security-baseline-audit.json`.

## Operational prerequisites (non-code, owner-driven)

These are deliberately outside the plan because they're operational, not code:

- **AWS KMS** — Create customer-managed key `ats-fit/resumes`; grant API role `kms:GenerateDataKey` + `kms:Decrypt`; set `AWS_KMS_KEY_ID` in Railway. (Needed before Phase 3.)
- **AWS S3 GuardDuty Malware Protection** — Enable on the resumes bucket. (Optional Phase 3 enhancement.)
- **Secret rotation** — Rotate `JWT_SECRET`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, `AWS_SECRET_ACCESS_KEY` in Railway after Phase 1 PR merges.
- **DPA + privacy policy** — Reflect resume retention window (30 days post-delete) and audit-log retention (365 days) after Phase 5 merges.

---

## Self-review checklist

- Coverage: every Critical/High/Medium/Low in the audit maps to a task; L1–L6 are operational notes only.
- No "implement later" placeholders; every code step shows the exact code or command.
- Type/name consistency across tasks: `buildResumeS3Key`, `sanitizeFilename`, `getPresignedPutUrl`, `token_version`, `uploadStatus`.
- Plan schema enforced: every task has `path`, `intent`, `verify`, `agency`, `docs`.
- No unit-test steps — verification is via lint/build/curl/SQL/AWS console.
- PR creation is user-gated — every phase ends with "stop and wait for user signal".
