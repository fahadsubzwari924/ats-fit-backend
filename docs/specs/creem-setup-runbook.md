---
doc_type: runbook
status: draft
owner: TBD
last_reviewed: 2026-08-24
---

# Creem setup runbook

> Follow top to bottom, in order. By the end: Creem test mode is configured, both plans are wired into the local database and code, a full checkout-to-cancellation cycle is verified end to end, and LemonSqueezy is decommissioned. Production cutover (Part D) is a separate, later pass through Parts A–C in live mode.

---

## Prerequisites

| Requirement | Check |
|---|---|
| Creem account | You can log in at https://creem.io |
| Creem CLI | `creem whoami` returns a logged-in identity (install below if not) |
| Local Postgres running | `psql -h localhost -U <user> -d <db> -c 'select 1;'` succeeds |
| Repo checked out, on this branch | `git status` shows `feat/creem-payment-migration` |

Install the CLI if you don't have it (source: https://docs.creem.io/code/cli):

```bash
npm install -g @creem_io/cli
# or: npx @creem_io/cli <command>
# or: brew tap armitage-labs/creem && brew install creem
```

---

## Part A — Test mode setup

Test and production are **completely isolated** in Creem — products, webhooks, and discounts each exist independently per environment and must be created twice, once per mode. Source: https://docs.creem.io/getting-started/test-mode

### A1. Toggle test mode

In the Creem dashboard, open the toggle at the **bottom of the left sidebar** and switch to **Test Mode**. Source: https://docs.creem.io/getting-started/test-mode

Everything in this Part A happens in test mode. Do not touch the toggle again until Part D.

### A2. Get a test API key

Dashboard → **Developers** section → copy the key. It's prefixed `creem_test_...`. Source: https://docs.creem.io/getting-started/quickstart

```bash
creem login --api-key creem_test_YOUR_KEY
creem whoami   # confirms the login
```

### A3. Create both products

> **Test and live product IDs are different products, in different databases, and Creem will not tell you.** A `creem_test_` key can only see products created in test mode. Copying an ID from the dashboard without checking which mode the dashboard toggle (A1) was on when you copied it — or copying an ID that was actually created in the other mode — produces a `404 "Product not found"` from Creem at checkout time, not at product-creation time, which makes it look like a bug in this codebase instead of a wrong ID. **Always fetch the IDs with the same key you're about to put in `.env.dev`** (see "Get the two product IDs" below) rather than trusting what you copied from the dashboard by eye.

Prices are in cents. This codebase's two plans, from `src/scripts/seed/seed-subscription-plans.ts`:

| Plan | Price | `--price` | `--billing-period` |
|---|---|---|---|
| Pro Monthly | $12.00 | `1200` | `every-month` |
| Pro Annual | $89.00 | `8900` | `every-year` |

```bash
creem products create \
  --name "Pro Monthly" \
  --description "ATS Fit Pro — monthly" \
  --price 1200 \
  --currency USD \
  --billing-type recurring \
  --billing-period every-month \
  --tax-category saas

creem products create \
  --name "Pro Annual" \
  --description "ATS Fit Pro — annual" \
  --price 8900 \
  --currency USD \
  --billing-type recurring \
  --billing-period every-year \
  --tax-category saas
```

Source for flags and billing-period/tax-category values: https://docs.creem.io/code/cli

Get the two product IDs (form `prod_...`) — **authoritative method: query the API with the key you will actually use**, not the dashboard:

```bash
creem products list --json | jq '.[] | {id, name, price, billing_period}'
```

or directly:

```bash
curl -s -H "x-api-key: $CREEM_API_KEY" \
  "https://test-api.creem.io/v1/products/search?page_size=20" | jq '.items[] | {id,name,price,billing_period}'
```

A `creem_test_` key returns **401** against `https://api.creem.io` (the live host) — a quick way to confirm which mode a key belongs to, and to catch a live/test host mismatch before it costs you a checkout failure.

Write both IDs down — `prod_XXXXXXXX` **(Pro Monthly, copy this from the CLI/curl output above)** and `prod_YYYYYYYY` **(Pro Annual, copy this from the CLI/curl output above)**. You need them in Part B.

### A4. Create the founding discount

The CLI has no documented discount/coupon create command — do this in the dashboard. Where exactly in the dashboard UI is not specified in the official docs consulted for this runbook — navigate to the discounts/coupons section for the current test-mode product and create a code.

Write down the discount code you create — **copy this from the dashboard**. It goes into `CREEM_FOUNDING_DISCOUNT_CODE` in A6.

### A5. Register the ngrok webhook

**Do not install the ngrok CLI.** This app opens its own tunnel using the
`@ngrok/ngrok` package (already a dependency). `main.ts` does it on boot when
all three of these are true in `src/config/.env.dev` — all three already are:

| Variable | Required value |
|---|---|
| `NODE_ENV` | `development` (or `local`) |
| `ENABLE_NGROK` | `true` |
| `NGROK_AUTH_TOKEN` | any valid ngrok token |

Start the app:

```bash
npm run start:dev
```

The app listens on the port in `PORT` (currently **3002**) and prints the
tunnel URL you need:

```
✅ Ngrok tunnel established: https://xxxx-xx-xx-xx-xx.ngrok-free.app
📱 Webhook URL for Creem dashboard: https://xxxx-....ngrok-free.app/api/v1/subscriptions/payment-confirmation
```

Copy that second URL into Creem's **Developers → Webhook** page (test mode),
then copy the `whsec_...` signing secret it gives you back into `.env.dev` in
step A6 and restart the app.

If you see `Ngrok tunnel disabled` or `NGROK_AUTH_TOKEN not set`, one of the
three variables above is wrong — the app boots fine either way, so check the
log line rather than assuming the tunnel is up.

The ngrok URL changes on every restart unless you have a reserved domain.
Re-register the new URL in Creem whenever it changes, or webhooks will
silently stop arriving.

### A6. Fill `.env.dev`

Open `src/config/.env.dev` (gitignored, already has the three keys present but empty) and **replace the existing empty keys in place** — do not append new ones further down the file:

```
CREEM_API_KEY=creem_test_YOUR_KEY
CREEM_WEBHOOK_SECRET=whsec_YOUR_SECRET
CREEM_FOUNDING_DISCOUNT_CODE=YOUR_DISCOUNT_CODE
```

Use the values from A2, A5, and A4 respectively.

`dotenv.parse` lets the **last** occurrence of a key win, so a second, appended set of `CREEM_*` lines happens to still work — but it leaves a stale empty (or wrong) copy sitting above the real one, confusing to whoever edits this file next. Check for duplicates before moving on:

```bash
grep -n '^CREEM_' src/config/.env.dev
```

Expect exactly three lines — one `CREEM_API_KEY`, one `CREEM_WEBHOOK_SECRET`, one `CREEM_FOUNDING_DISCOUNT_CODE`. More than three means you appended instead of replacing — delete the stale set.

---

## Part B — Wire the values into the code

### B1. Update both seed files

Two files carry product IDs and **both** must be updated — they are not the same file and neither imports the other:

- `src/scripts/seed/seed-subscription-plans.ts` — the live path; `npm run seed:subscription-plans` runs `seed-subscription-plans-standalone.ts`, which imports this file.
- `src/scripts/seed/seed-subscription-plans-service.ts` — a second, independent copy of the same two plan objects.

In **both** files, replace the placeholder `payment_gateway_product_id` values with the real ones from A3:

```diff
- payment_gateway_product_id: '1012070',   // Pro Monthly
+ payment_gateway_product_id: 'prod_XXXXXXXX',
```
```diff
- payment_gateway_product_id: '1012071',   // Pro Annual
+ payment_gateway_product_id: 'prod_YYYYYYYY',
```

### B2. THE TRAP — do not just re-run the seed

`seedSubscriptionPlans()` in `seed-subscription-plans.ts` does a **blind insert**: `repo.create(...)` then `repo.save(...)`. There is no upsert. `subscription_plans.payment_gateway_product_id` has a UNIQUE constraint.

Proven against the live local database: inserting a row with a new product ID while an old plan row already exists produces **two "Pro Monthly" rows**, not an update. The seed function's own guard (`if (existingPlansCount > 0) return`) only protects against re-running it — it does not protect you from running it once against a database that already has the *old* LemonSqueezy-era rows.

**The local database already has plan rows** (product IDs `1639212` for Pro Monthly, `1639208` for Pro Annual — themselves not even matching the seed file's old placeholders, so seed file and database are already out of sync before this runbook started).

So: on any database that already has rows in `subscription_plans`, **update the existing rows**. Only run the seed script on a genuinely empty `subscription_plans` table.

```sql
UPDATE subscription_plans SET payment_gateway_product_id = 'prod_XXXXXXXX' WHERE plan_name = 'Pro Monthly';
UPDATE subscription_plans SET payment_gateway_product_id = 'prod_YYYYYYYY' WHERE plan_name = 'Pro Annual';
```

Verify:

```sql
SELECT plan_name, payment_gateway_product_id, is_active FROM subscription_plans ORDER BY plan_name;
```

Expect exactly two rows, `prod_XXXXXXXX` and `prod_YYYYYYYY`, `is_active = true`. If you see more than two rows, or any row with a `1012...`/`1639...`-style numeric ID, the seed was run in error — deactivate or delete the stray row before continuing (decide by inspecting `user_subscriptions`/`payment_history` for references to it first).

### B3. Apply migrations

Three migrations must land: `1815300000000-RenameVariantToProductAndAddCustomerId`, `1815400000000-AddProcessingClaimedAtToPaymentHistory`, `1815500000000-AddAnonymizedAtToPaymentHistory`.

```bash
npm run migration:run
```

Confirm:

```bash
npm run migration:show
```

All three should show as applied (`[X]`).

---

## Part C — Verify end to end

Use a real authenticated user and a real subscription plan row. Have `npm run start:dev` running.

The port below is `PORT` in `src/config/.env.dev`, currently **3002** — it is environment-specific, so confirm it on your machine before running anything in this part:

```bash
grep '^PORT=' src/config/.env.dev
```

Port 3000 is a common default for other local projects (e.g. a Next.js app) — hitting the wrong port returns *that* app's response, not a routing error in this codebase, which is a confusing failure to debug.

### C0. Get a local JWT

Sign in against **this** running instance, not a token copied from another environment (staging, production, or an older local database). A token minted elsewhere carries a `sub` (user id) from that environment's database — it passes signature verification, then fails the user lookup with `ERR_USER_NOT_FOUND`, because no user with that id exists locally (even if the same email does, under a different id).

```bash
curl -s -X POST http://localhost:3002/api/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"<your local account email>","password":"<password>"}'
```

Copy `access_token` from the response — that's `<your JWT>` in C1 and C3 below.

### C1. Checkout session

```bash
curl -X POST http://localhost:3002/api/v1/subscriptions/checkout \
  -H "Authorization: Bearer <your JWT>" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "<subscription_plans.id UUID for Pro Monthly>"}'
```

Note: `plan_id` here is this codebase's internal `subscription_plans.id` (UUID), not the Creem `prod_...` ID — the controller resolves the plan row first, then sends its `payment_gateway_product_id` to Creem.

**Expect**: `201`, body contains `checkoutUrl` (a `https://creem.io/payment/...`-style URL) and `success: true`.

### C2. Pay and confirm activation

**Precondition**: if the test user is already `plan = premium`, this check cannot prove the upgrade happened. Reset first:

```sql
UPDATE users SET plan = 'freemium' WHERE id = '<your user id>';
```

```sql
SELECT plan FROM users WHERE id = '<your user id>';   -- expect: freemium
```

Open `checkoutUrl` in a browser, pay with a test card (any future expiry, any CVV):

| Card | Result |
|---|---|
| `4111 1111 1111 1111` | success |
| `4507 9900 0000 0028` | declined |
| `4507 9900 0000 0010` | insufficient funds |
| `4507 9900 0000 0044` | incorrect CVC |

Use `4111 1111 1111 1111`.

**Expect**: `checkout.completed` and `subscription.active` webhook deliveries arrive at your ngrok URL (watch `npm run start:dev` logs for `✅ Webhook processed`), signature verifies, and:

```sql
SELECT id, user_id, subscription_plan_id, is_active, is_cancelled, status, starts_at, ends_at
FROM user_subscriptions WHERE user_id = '<your user id>';
```

One row, `is_active = true`, `is_cancelled = false`. Also confirm the user is premium:

```sql
SELECT id, plan FROM users WHERE id = '<your user id>';   -- expect: premium
```

### C3. Cancel

`<subscription id>` is **this codebase's `user_subscriptions.id`** (a UUID) — never Creem's `sub_...` id. The route is `@Param('id', ParseUUIDPipe)`: a Creem id fails the pipe with a 400 before any code runs. The service looks the row up by this UUID, checks ownership, then reads `payment_gateway_subscription_id` off that row to call Creem.

```sql
SELECT id AS use_this_id, payment_gateway_subscription_id AS creem_id_do_not_use, status
FROM user_subscriptions WHERE user_id = '<your user id>' ORDER BY created_at DESC LIMIT 1;
```

```bash
curl -X DELETE http://localhost:3002/api/v1/subscriptions/<subscription id>/cancel \
  -H "Authorization: Bearer <your JWT>"
```

**Expect**: `200`. In the Creem dashboard, the subscription shows a scheduled cancellation. Locally:

```sql
SELECT is_active, is_cancelled, cancelled_at, status FROM user_subscriptions WHERE id = '<subscription id>';
```

`is_cancelled = true` **and `is_active` still `true`** — the user paid for the current period and keeps premium until it ends. `status = 'scheduled_cancel'`.

### C4. Replay protection on a `subscription.paid` delivery

"Resend from the dashboard" does not give enough control to build this test (no way to force a second, byte-identical delivery, or a third with the same transaction id but different content) — sign and send deliveries locally instead. This method was executed successfully and is the verified way to run this check.

Creem's standard signature scheme signs `${webhook-id}.${webhook-timestamp}.${rawBody}` with HMAC-SHA256, keyed by the webhook secret with its `whsec_` prefix stripped and the remainder base64-decoded, sent as header `webhook-signature: v1,<base64 digest>` alongside `webhook-id` and `webhook-timestamp` (verifier: `src/modules/subscription/externals/webhooks/creem-webhook-verifier.ts`). The body must be `JSON.stringify`'d **exactly once** and that same string reused verbatim both to compute the signature and as the HTTP request body — `JSON.stringify` is not guaranteed to produce the same bytes twice, so re-serializing between signing and sending is a real way to break your own test.

Requires Node 18+ (uses the built-in `fetch`) — check with `node -v`.

Save this script:

```bash
cat > /tmp/creem-webhook-replay-test.js <<'EOF'
#!/usr/bin/env node
// Sends 3 signed `subscription.paid` deliveries to the local webhook
// endpoint. See docs/specs/creem-setup-runbook.md, Part C, C4.
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const SECRET = requireEnv('CREEM_WEBHOOK_SECRET');   // whsec_... from .env.dev
const GATEWAY_SUB_ID = requireEnv('GATEWAY_SUB_ID'); // C3's payment_gateway_subscription_id
const USER_ID = requireEnv('USER_ID');
const PLAN_ID = requireEnv('PLAN_ID');               // subscription_plans.id (UUID), Pro Monthly
const TRANSACTION_ID = process.env.TRANSACTION_ID || `evt_replay_${Date.now()}`;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildDelivery(periodStart, periodEnd) {
  const payload = {
    id: TRANSACTION_ID, // dedup key payment_history claims on — same for all 3 sends
    eventType: 'subscription.paid',
    object: {
      id: GATEWAY_SUB_ID,
      status: 'active',
      currentPeriodStartDate: periodStart,
      currentPeriodEndDate: periodEnd,
      metadata: { user_id: USER_ID, plan_id: PLAN_ID },
    },
  };
  const rawBody = JSON.stringify(payload); // stringify ONCE — reused verbatim below
  const webhookId = `msg_${crypto.randomBytes(8).toString('hex')}`;
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const stripped = SECRET.startsWith('whsec_') ? SECRET.slice(6) : SECRET;
  const key = Buffer.from(stripped, 'base64');
  const digest = crypto
    .createHmac('sha256', key)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest('base64');
  return { rawBody, webhookId, webhookTimestamp, signature: `v1,${digest}` };
}

async function send(label, delivery) {
  const res = await fetch(`${BASE_URL}/api/v1/subscriptions/payment-confirmation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': delivery.webhookId,
      'webhook-timestamp': delivery.webhookTimestamp,
      'webhook-signature': delivery.signature,
    },
    body: delivery.rawBody, // the exact string that was signed
  });
  console.log(`${label}: HTTP ${res.status}`);
}

(async () => {
  console.log(`transaction id (all 3 deliveries): ${TRANSACTION_ID}`);

  // Dates are computed from "now", not hardcoded — the handler treats a
  // periodStart that isn't strictly newer than the row's current starts_at
  // as a stale/out-of-order event and skips it (subscription.service.ts,
  // processPaymentGatewayEvent). A hardcoded date could land before C2's
  // real starts_at (e.g. if C2 ran earlier today) and make delivery 1 look
  // "blocked" for the wrong reason.
  const now = new Date();
  const original = buildDelivery(now.toISOString(), addDays(now, 30));
  await send('1st delivery (original)', original);
  await send('2nd delivery (byte-identical replay: same body, same signature)', original);

  // Same transaction id, dates pushed ~1 year further out — clearly newer
  // than delivery 1's, so this is NOT blocked by the staleness check above.
  // If starts_at/ends_at still don't move, the claim gate is what blocked it.
  const renewed = buildDelivery(addDays(now, 400), addDays(now, 430));
  await send('3rd delivery (same transaction id, dates ~1 year later)', renewed);
})();
EOF
```

Run it (values from C3's SQL query and C1's plan lookup):

```bash
CREEM_WEBHOOK_SECRET='whsec_YOUR_SECRET' \
GATEWAY_SUB_ID='sub_...' \
USER_ID='<your user id>' \
PLAN_ID='<subscription_plans.id UUID for Pro Monthly>' \
node /tmp/creem-webhook-replay-test.js
```

**Expect**: `1st delivery` → `201`, `2nd delivery` → `201` (the endpoint always accepts a duplicate with the same success status; it's the *side effect* that's gated, not the response code), `3rd delivery` → `201`.

```sql
SELECT count(*) FROM payment_history WHERE payment_gateway_transaction_id = '<transaction id printed above>';
-- must stay 1 after all 3 deliveries
```

```sql
SELECT starts_at, ends_at, status, is_cancelled FROM user_subscriptions WHERE payment_gateway_subscription_id = '<gateway sub id>';
```

Two deliveries alone can't prove which mechanism blocked the repeat — a coincidence (the handler re-ran but happened to be idempotent) looks identical to a real gate from the outside. That's what the 3rd delivery is for: it carries **the same transaction id** but a period start/end roughly a year further out — well clear of the staleness check, so nothing else in the code would suppress it. It would clearly change `starts_at`/`ends_at` if the handler ran again. **If the dates still don't move, the claim gate genuinely blocked the handler** — this codebase's atomic claim gate (`payment_history.processing_claimed_at`, `PaymentHistoryService.claimPaymentEvent`) marks any delivery `duplicate` once the first one for that transaction id has `processed_at` set, and the webhook controller returns before the handler that updates `user_subscriptions.starts_at`/`ends_at` ever runs — regardless of what the duplicate's payload contains. So: **`starts_at`/`ends_at` must equal what the 1st delivery set, unchanged by the 2nd and 3rd.**

Also expect `status` back to `active` and `is_cancelled = false`, even though C3 left this subscription `scheduled_cancel` — a legitimate renewal correctly clears a scheduled cancellation (the user paid for a new period). This is expected, not a bug.

### C5. Forged webhooks — six bypass attempts, plus a control

One forged case alone doesn't prove much on its own — six were actually run against this endpoint, each covering a distinct bypass, all rejected identically:

| # | Forged request | Why it matters |
|---|---|---|
| 1 | No signature headers at all | The original vulnerability — `if (!signature) return true` |
| 2 | Wrong `creem-signature` (legacy scheme) | Legacy path forgery |
| 3 | Wrong `webhook-signature` (standard scheme) | Standard path forgery |
| 4 | Partial standard headers + a legacy header | Downgrade oracle — must not fall through to the weaker scheme |
| 5 | Empty signature value | Empty-string bypass |
| 6 | Garbage / odd-length hex signature | Buffer-truncation bypass |

```bash
# 1. No signature headers at all
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_forge_1","eventType":"subscription.paid","object":{"id":"sub_fake"}}'

# 2. Wrong creem-signature (legacy scheme)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -H "creem-signature: sha256=0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"id":"evt_forge_2","eventType":"subscription.paid","object":{"id":"sub_fake"}}'

# 3. Wrong webhook-signature (standard scheme)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -H "webhook-id: msg_forge_3" \
  -H "webhook-timestamp: $(date +%s)" \
  -H "webhook-signature: v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
  -d '{"id":"evt_forge_3","eventType":"subscription.paid","object":{"id":"sub_fake"}}'

# 4. Partial standard headers + a legacy header (downgrade oracle)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -H "webhook-id: msg_forge_4" \
  -H "creem-signature: sha256=0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"id":"evt_forge_4","eventType":"subscription.paid","object":{"id":"sub_fake"}}'

# 5. Empty signature value
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -H "webhook-id: msg_forge_5" \
  -H "webhook-timestamp: $(date +%s)" \
  -H "webhook-signature: " \
  -d '{"id":"evt_forge_5","eventType":"subscription.paid","object":{"id":"sub_fake"}}'

# 6. Garbage / odd-length hex signature
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/v1/subscriptions/payment-confirmation \
  -H "Content-Type: application/json" \
  -H "creem-signature: sha256=abc" \
  -d '{"id":"evt_forge_6","eventType":"subscription.paid","object":{"id":"sub_fake"}}'
```

**Expect**: all six return the identical `400` with the identical generic body — by design, no rejection reason is ever disclosed to the caller (a varying response would hand an attacker a channel for refining a forged signature; see `rejectWebhook()` in `subscription.controller.ts`).

**No database writes**, for any of the six — compare counts before and after the whole batch:

```sql
SELECT count(*) FROM payment_history WHERE payment_gateway_transaction_id LIKE 'evt_forge_%';
-- must be 0
```

```sql
SELECT is_active, is_cancelled, status, starts_at, ends_at FROM user_subscriptions WHERE payment_gateway_subscription_id = '<gateway sub id from C3/C4>';
-- must be unchanged from before this section
```

**Control — a validly-signed delivery must still return `201`**, proving the endpoint is discriminating rather than simply broken (rejecting everything would trivially "pass" all six checks above for the wrong reason). Reuse the C4 script for this — one delivery with a fresh transaction id:

```bash
CREEM_WEBHOOK_SECRET='whsec_YOUR_SECRET' \
GATEWAY_SUB_ID='sub_...' \
USER_ID='<your user id>' \
PLAN_ID='<subscription_plans.id UUID for Pro Monthly>' \
TRANSACTION_ID='evt_control_1' \
node /tmp/creem-webhook-replay-test.js
```

Expect its 1st delivery to return `201`, matching C4, while all six forged cases above returned `400`.

---

## Part D — Production cutover

Test-mode objects do **not** carry over to production — repeat A1 (toggle to **live** mode this time), A3 (create both products again, live mode), A4 (founding discount, live mode), A5 (register the production webhook URL — your real domain, not ngrok — and copy the **live** `whsec_...` secret).

Then:

1. Set `CREEM_API_KEY` (prefix `creem_`, no `_test_`), `CREEM_WEBHOOK_SECRET`, `CREEM_FOUNDING_DISCOUNT_CODE` in the **Railway dashboard** for the production service — not in the repo, not in `src/config/.env.prod` (that file is a local reference copy only; Railway env vars are the source of truth in prod).
2. Repeat Part B's seed-file edits and the `UPDATE subscription_plans` SQL against the **production** database, using the live-mode `prod_...` IDs.
3. Migrations run automatically: `railway.toml` sets `preDeployCommand = "npm run migration:run:prod"`. No manual step needed on deploy — but schema and code must ship in the **same deploy**: do not merge the seed-file/product-ID code changes to `master` before Railway env vars are set, or checkout requests will start hitting live-mode product IDs the account doesn't actually have provisioned yet (or vice versa).
4. Re-run Part C's five checks against production, with real test cards replaced by extreme caution — production is live money. Prefer a $0 or refundable path if your Creem live account supports one; otherwise use a card you're prepared to have actually charged and then refund.

---

## Part E — Decommission LemonSqueezy

Once Part D is verified:

1. Revoke the LemonSqueezy API key(s) in the LemonSqueezy dashboard — Settings → API. Do this only after production Creem traffic is confirmed working (Part D step 4), so there's no live rollback path left dangling on a revoked key.
2. Delete `src/config/.env.prod.backup`. It is gitignored (never made it into the repo history) but sits on disk with live LemonSqueezy credentials in plaintext (`LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_NAME`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, `LEMON_SQUEEZY_LICENSE_KEY`):
   ```bash
   rm src/config/.env.prod.backup
   ```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every webhook returns 400 | Wrong `CREEM_WEBHOOK_SECRET` for the environment, or a test-mode secret configured against a production endpoint (or vice versa) |
| "Subscription not found" / gateway calls fail on every request | `CREEM_API_KEY` missing or empty — check `.env.dev`/`.env.staging`/Railway env vars |
| Two rows for the same plan name in `subscription_plans` | The seed script was run against a database that already had plan rows (see Part B2's trap) — use the `UPDATE` SQL instead, then remove the stray duplicate row after checking it isn't referenced by `user_subscriptions`/`payment_history` |
| `POST /subscriptions/checkout` returns 400 | The plan row's `payment_gateway_product_id` doesn't match any product in the Creem account/mode being hit — confirm you updated both seed files (or ran the `UPDATE` SQL) with the correct-environment product ID |
| Creem returns `404 "Product not found"` at checkout | The `prod_...` ID in `subscription_plans` was copied from the wrong mode (e.g. a live-mode ID while `CREEM_API_KEY` is `creem_test_...`) — test and live products are fully isolated (A3). Re-fetch the ID with the API key you're actually using, not from the dashboard by eye |
| Webhooks never arrive | ngrok URL changed since it was registered (ngrok free URLs are not stable across restarts — re-register in Developers → Webhook after every `npm run ngrok` restart), or the endpoint was registered in the wrong mode (test URL registered while dashboard was in live mode, or vice versa) |

---

## Open items from this runbook

- A4's exact dashboard navigation for creating a discount code is not specified — the official docs consulted (test-mode and quickstart pages) don't cover it. Locate it directly in the dashboard when you get there.
