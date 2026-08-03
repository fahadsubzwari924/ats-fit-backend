---
doc_type: technical-reference
status: authoritative
owner: TBD
last_reviewed: 2026-08-03
---

# Creem SDK surface (ground truth from `node_modules/creem`)

This document exists because published Creem docs and the SDK README disagree on method
names. Everything below was read directly from the installed package's shipped `.d.ts`
files (and, where noted, its `README.md`). **Nothing here is from web docs or memory.**
Every claim cites `file:line`. If you add a new call not covered here, read the
`.d.ts` yourself and extend this file — do not guess from the web.

Installed via `npm install creem` on 2026-08-03, from branch `feat/creem-payment-migration`.

## Installed version

**`1.6.0`**

Source: `node_modules/creem/package.json:3` (`"version": "1.6.0"`).

## Package entry points (why this matters for imports)

`node_modules/creem/package.json:139-141`:
```json
"main": "./dist/commonjs/index.js",
"types": "./dist/commonjs/index.d.ts",
"module": "./dist/esm/index.js"
```

The package also declares a conditional `exports` map (`node_modules/creem/package.json:59-138`)
with explicit subpaths for `.`, `./types`, `./models/errors`, `./models/components`,
`./models/operations`, plus wildcard fallbacks `./*.js` and `./*` that map any other
subpath (e.g. `creem/webhooks`) to `./dist/{esm,commonjs}/*.d.ts` / `*.js`
(`node_modules/creem/package.json:116-137`).

**Verified constraint for this repo:** this repo's `tsconfig.json` sets
`"module": "commonjs"` with no explicit `moduleResolution`
(`tsconfig.json:3`), which makes TypeScript 5.7 default to classic
`Node10`-style resolution. Node10 resolution does **not** consult a package's
`exports` map for subpath imports — it only reads the root `main`/`types` fields.

I verified this directly: I created a throwaway probe file at the repo root
(`import { Creem } from "creem"; import { verifyWebhookSignature } from "creem/webhooks";`)
and ran `npx tsc --noEmit` against it with this repo's compiler flags. Result:

- `import { Creem } from "creem"` — **resolves fine** (root `types` field, `package.json:140`).
- `import { verifyWebhookSignature } from "creem/webhooks"` — **fails**:
  ```
  error TS2307: Cannot find module 'creem/webhooks' or its corresponding type declarations.
    There are types at '.../node_modules/creem/dist/esm/webhooks.d.ts', but this result
    could not be resolved under your current 'moduleResolution' setting. Consider updating
    to 'node16', 'nodenext', or 'bundler'.
  ```

**Action needed in a later task (flagging, not fixing here):** either (a) bump
`moduleResolution` to `bundler`/`node16`/`nodenext` in `tsconfig.json`, or (b) avoid the
`creem/webhooks` subpath import and re-implement webhook verification manually (see
"Webhook verification" section below — the algorithm is fully documented so this is
straightforward either way). This task does not modify `tsconfig.json` or any `src/`
file per the constraints; it only records the fact for whoever implements Task 6.

The probe file was deleted after the check; it is not part of this commit.

## Constructor / client options

Import: `import { Creem } from "creem";` — confirmed both by the type declaration and by
`node_modules/creem/README.md:172-176`:
```ts
import { Creem } from "creem";

const creem = new Creem({
  apiKey: process.env["CREEM_API_KEY"] ?? "",
});
```

Constructor signature: `constructor(options?: SDKOptions);`
— `node_modules/creem/dist/commonjs/lib/sdks.d.ts:53` (the `Creem` class extends
`ClientSDK`, which declares the constructor; `Creem` itself adds no constructor override —
`node_modules/creem/dist/commonjs/sdk/sdk.d.ts:13`).

`SDKOptions` fields — `node_modules/creem/dist/commonjs/lib/config.d.ts:19-40`:

| Field | Type | Notes |
|---|---|---|
| `apiKey` | `string \| (() => Promise<string>) \| undefined` | line 20 |
| `httpClient` | `HTTPClient` | line 21 |
| `server` | `keyof typeof ServerList \| undefined` | line 25. **Not `serverIdx`** — the task brief's guessed field name is wrong. Valid values are the keys of `ServerList`: `"prod"` and `"test"` (lines 15-18: `prod: "https://api.creem.io"`, `test: "https://test-api.creem.io"`). |
| `serverURL` | `string \| undefined` | line 29. Overrides the base URL directly, independent of `server`. |
| `userAgent` | `string \| undefined` | line 33 |
| `retryConfig` | `RetryConfig` | line 37 |
| `timeoutMs` | `number` | line 38 |
| `debugLogger` | `Logger` | line 39 |

README corroboration for `server` vs `serverURL` (both documented as separate,
mutually-independent overrides): `node_modules/creem/README.md:559` (`server:
keyof typeof ServerList`) and `node_modules/creem/README.md:590` (`serverURL: string`).

**Correction of the task brief:** the brief asked to record "`serverIdx` vs `serverURL`".
The actual option is named **`server`**, not `serverIdx`. There is no `serverIdx` field
anywhere in the shipped types (`grep -r "serverIdx" node_modules/creem` returns nothing).

## SDK surface (namespace getters on the `Creem` client)

The `Creem` class exposes namespaced sub-clients as getters —
`node_modules/creem/dist/commonjs/sdk/sdk.d.ts:13-36`:

```ts
export declare class Creem extends ClientSDK {
    get products(): Products;
    get customers(): Customers;
    get subscriptions(): Subscriptions;
    get checkouts(): Checkouts;
    get licenses(): Licenses;
    get discounts(): Discounts;
    get transactions(): Transactions;
    get stats(): Stats;
    get moderation(): Moderation;
    get customerCredits(): CustomerCredits;
    get affiliates(): Affiliates;
}
```

This confirms the call shape is `creem.<namespace>.<method>(...)` — e.g.
`creem.checkouts.create(...)`, matching the web docs' style, **not** the flat
`createCheckout(...)` style some other source suggested.

### Create checkout

`node_modules/creem/dist/commonjs/sdk/checkouts.d.ts:17`:
```ts
create(request: components.CreateCheckoutRequest, options?: RequestOptions): Promise<components.CheckoutEntity>;
```

Call shape: **`creem.checkouts.create(request, options?)`** — confirmed method name is
`create`, not `createCheckout`.

`CreateCheckoutRequest` — `node_modules/creem/dist/commonjs/models/components/createcheckoutrequest.d.ts:6-51`:

| Field | Type | Required | Line |
|---|---|---|---|
| `requestId` | `string \| undefined` | no | 10 |
| `productId` | `string` | **yes** | 14 |
| `units` | `number \| undefined` | no | 18 |
| `customPrice` | `number \| undefined` (cents; one-time products only) | no | 22 |
| `discountCode` | `string \| undefined` | no | 26 |
| `customer` | `CustomerRequestEntity \| undefined` | no | 30 |
| `customFields` | `Array<CustomFieldRequestEntity> \| undefined` | no | 34 |
| `customField` | `Array<CustomFieldRequestEntity> \| undefined` — **deprecated**, use `customFields` | no | 40 |
| `successUrl` | `string \| undefined` | no | 44 |
| `metadata` | `{ [k: string]: any } \| undefined` | no | 48-50 |

On-the-wire (snake_case) field names — `createcheckoutrequest.d.ts:55-68`
(`CreateCheckoutRequest$Outbound`): `request_id`, `product_id`, `units`, `custom_price`,
`discount_code`, `customer`, `custom_fields`, `custom_field`, `success_url`, `metadata`.
The SDK itself does the camelCase → snake_case conversion; callers use camelCase.

Response type `CheckoutEntity` — `node_modules/creem/dist/commonjs/models/components/checkoutentity.d.ts:67-144`. Key fields:

| Field | Type | Line |
|---|---|---|
| `id` | `string` | 71 |
| `mode` | `EnvironmentMode` | 75 |
| `status` | `Status` (`"pending" \| "processing" \| "completed" \| "expired"`, lines 16-21) | 83 |
| `requestId` | `string \| undefined` | 87 |
| `product` | `ProductEntity \| string` | 91 |
| `order` | `OrderEntity \| undefined` | 103 |
| `subscription` | `SubscriptionEntity \| string \| undefined` | 107 |
| `customer` | `CustomerEntity \| string \| undefined` | 111 |
| `checkoutUrl` | `string \| undefined` — the URL to redirect the customer to | 119 |
| `successUrl` | `string \| null \| undefined` | 123 |
| `metadata` | `{ [k: string]: any } \| undefined` | 137-139 |

### Get subscription

`node_modules/creem/dist/commonjs/sdk/subscriptions.d.ts:12`:
```ts
get(subscriptionId: string, options?: RequestOptions): Promise<components.SubscriptionEntity>;
```

Call shape: **`creem.subscriptions.get(subscriptionId, options?)`**.

Response type `SubscriptionEntity` — `node_modules/creem/dist/commonjs/models/components/subscriptionentity.d.ts:49-128`. Key fields:

| Field | Type | Line |
|---|---|---|
| `id` | `string` | 53 |
| `mode` | `EnvironmentMode` | 57 |
| `product` | `ProductEntity \| string` | 65 |
| `customer` | `CustomerEntity \| string` | 69 |
| `items` | `Array<SubscriptionItemEntity> \| undefined` | 73 |
| `collectionMethod` | `SubscriptionCollectionMethod` | 77 |
| `status` | `SubscriptionStatus` | 81 |
| `lastTransactionId` / `lastTransaction` / `lastTransactionDate` | — | 85-93 |
| `nextTransactionDate` | `Date \| undefined` | 97 |
| `currentPeriodStartDate` / `currentPeriodEndDate` | `Date \| undefined` | 101-105 |
| `canceledAt` | `Date \| null \| undefined` | 109 |
| `createdAt` / `updatedAt` | `Date` (required) | 113, 117 |
| `metadata` | `{ [k: string]: any } \| undefined` | 125-127 |

`SubscriptionStatus` enum values — `node_modules/creem/dist/commonjs/models/components/subscriptionstatus.d.ts:6-14`:
`"active" | "canceled" | "unpaid" | "paused" | "trialing" | "scheduled_cancel" | "past_due"`.

### Cancel subscription

`node_modules/creem/dist/commonjs/sdk/subscriptions.d.ts:28`:
```ts
cancel(id: string, cancelSubscriptionRequestEntity: components.CancelSubscriptionRequestEntity, options?: RequestOptions): Promise<components.SubscriptionEntity>;
```

Call shape: **`creem.subscriptions.cancel(id, cancelSubscriptionRequestEntity, options?)`**
— note this takes a **required second argument** (not optional), unlike a bare
`cancelSubscription(id)` call some sources suggest.

`CancelSubscriptionRequestEntity` — `node_modules/creem/dist/commonjs/models/components/cancelsubscriptionrequestentity.d.ts:27-36`:

| Field | Type | Line |
|---|---|---|
| `mode` | `Mode \| undefined` — `"immediate" \| "scheduled"` (enum at lines 8-11) | 31 |
| `onExecute` | `OnExecute \| undefined` — `"cancel" \| "pause"`, only used when `mode: "scheduled"` (enum at lines 19-22) | 35 |

Both fields are optional; an empty object `{}` is a valid request body (defaults come from
store billing settings per the doc comment at lines 6-7, 29-30).

### Customer billing/portal link

`node_modules/creem/dist/commonjs/sdk/customers.d.ts:60`:
```ts
generateBillingLinks(request: components.CreateCustomerPortalLinkRequestEntity, options?: RequestOptions): Promise<components.CustomerLinksEntity>;
```

Call shape: **`creem.customers.generateBillingLinks(request, options?)`** — confirmed
method name is `generateBillingLinks` (matches the web docs), **not**
`generateCustomerLinks` (the other guessed name is wrong; no such method exists on
`Customers` — `node_modules/creem/dist/commonjs/sdk/customers.d.ts:5-61` lists every
method on the class and `generateCustomerLinks` is not among them).

`CreateCustomerPortalLinkRequestEntity` — `node_modules/creem/dist/commonjs/models/components/createcustomerportallinkrequestentity.d.ts:4-9`:

| Field | Type | Line |
|---|---|---|
| `customerId` | `string` (required) | 8 |

Response `CustomerLinksEntity` — `node_modules/creem/dist/commonjs/models/components/customerlinksentity.d.ts:4-9`:

| Field | Type | Line |
|---|---|---|
| `customerPortalLink` | `string` | 8 |

### Webhook verification

**A verify helper exists.** It ships as a standalone module, not as a method on the
`Creem` client class — `node_modules/creem/dist/commonjs/webhooks.d.ts`. It is reachable
at runtime via `require("creem/webhooks")` (works — Node honors the package's `exports`
map), but **not** via a `tsc`-checked `import` under this repo's current
`moduleResolution` (see "Package entry points" section above — verified by probe, fails
with `TS2307`).

Exports — `node_modules/creem/dist/commonjs/webhooks.d.ts:22-29`:

```ts
export declare class WebhookVerificationError extends Error {
    constructor(message: string);
}
export declare const verifyWebhookSignature: (
  payload: string | ArrayBuffer | Uint8Array,
  headers: WebhookHeaders,
  options: string | WebhookSecretOptions
) => Promise<void>;
export declare const parseWebhookEvent: <TData = unknown>(payload: string | ArrayBuffer | Uint8Array) => CreemWebhookEvent<TData>;
export declare const parseWebhookEventEntity: (payload: string | ArrayBuffer | Uint8Array) => WebhookEventEntity;
export declare const constructWebhookEvent: <TData = unknown>(payload, headers, options) => Promise<CreemWebhookEvent<TData>>;
export declare const constructWebhookEventEntity: (payload, headers, options) => Promise<WebhookEventEntity>;
```

`WebhookSecretOptions` — `webhooks.d.ts:3-6`: `{ secret: string; toleranceInSeconds?: number }`.
`WebhookHeaders` — `webhooks.d.ts:2`: `Headers | Iterable<[string, string]> | Record<string, string | string[] | undefined>`.

**Verified algorithm** (read from the implementation, `node_modules/creem/dist/commonjs/webhooks.js`,
since the `.d.ts` only gives signatures). `verifyWebhookSignature` tries two schemes in order:

1. **"Standard webhook" scheme** (`webhooks.js:108-125`, tried first):
   - Reads headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (lowercased header
     names, line 109-111). If any is missing, falls through to the legacy scheme.
   - Rejects if `|now - timestamp| > toleranceInSeconds` (default 300s, `webhooks.js:12`,
     enforced in `verifyTimestamp` at lines 94-107).
   - Secret: if it starts with `whsec_`, that prefix is stripped, then the remainder is
     base64-decoded as the HMAC key (`webhooks.js:116`).
   - Expected signature = base64(HMAC-SHA256(key, `${id}.${timestamp}.${payload}`))
     (`webhooks.js:117`).
   - `webhook-signature` header is space-separated `version,signature` pairs (e.g.
     `v1,<sig> v2,<sig>`); accepts if any pair has `version === "v1"` and a
     timing-safe-equal match (`webhooks.js:118-123`).

2. **Legacy scheme** (`webhooks.js:126-135`, fallback if standard-webhook headers are absent):
   - Reads header `creem-signature`, falling back to `x-creem-signature`
     (`webhooks.js:127`).
   - Expected signature = hex(HMAC-SHA256(utf8(secret), payload)) — **secret used raw,
     no `whsec_` stripping, no base64 decode, key is the raw signing secret string**
     (`webhooks.js:131`).
   - Accepts the header value as-is or with a leading `sha256=` stripped, matched
     case-insensitively (`webhooks.js:88-92`, `normalizeLegacySignature`).
   - Timing-safe compare (`webhooks.js:132`).

HMAC is computed via Web Crypto (`globalThis.crypto.subtle`); throws
`WebhookVerificationError("Web Crypto is not available")` if absent (`webhooks.js:81-87`).
Node.js has Web Crypto globally available since v19 (and behind a flag earlier) — worth
confirming the Node runtime version in the deploy target before relying on this helper.

`parseWebhookEvent` (`webhooks.js:146-163`) just does `JSON.parse` on the payload and reads
`type` (falling back to `eventType`) and `data`/`object` — it does **not** verify anything
itself; verification and parsing are separate steps unless you use `constructWebhookEvent`
(`webhooks.js:172-176`), which calls `verifyWebhookSignature` then `parseWebhookEvent`.

**Recommendation for Task 6:** given the `creem/webhooks` subpath does not type-check
under this repo's current `moduleResolution`, either raise `moduleResolution` to
`node16`/`nodenext`/`bundler` in `tsconfig.json`, or hand-roll the HMAC verification per
the algorithm documented above (`crypto.createHmac('sha256', ...)` in Node's `node:crypto`
module is a direct equivalent to the Web Crypto calls in `webhooks.js:81-87`). Either path
is viable; this task deliberately does not decide it since it touches `tsconfig.json` /
`src/`, which are out of scope here.

### Webhook event payload shapes (bonus — found while reading the above)

`WebhookEventEntity` is a discriminated union keyed on `eventType` —
`node_modules/creem/dist/commonjs/models/components/webhookevententity.d.ts:17-42`. The
observed `eventType` string literals are: `checkout.completed`, `refund.created`,
`dispute.created`, `subscription.active`, `subscription.trialing`,
`subscription.canceled`, `subscription.scheduled_cancel`, `subscription.paid`,
`subscription.expired`, `subscription.unpaid`, `subscription.update`,
`subscription.past_due`, `subscription.paused`. Each variant has its own entity file next
to `webhookevententity.d.ts` (e.g. `webhookcheckoutcompletedevententity.d.ts`) — not
transcribed here since it's out of scope for Task 1; flagging so whoever does Task 2
(internal payment event types) knows where to look instead of guessing event names.

## Things NOT determined from the package

None. All five required surfaces (create-checkout, get-subscription,
cancel-subscription, customer-billing-link, webhook-verify) plus the constructor were
found directly in the shipped `.d.ts`/`.js` files, with the webhook-verify helper's
existence and exact algorithm confirmed by reading its compiled implementation rather
than just its type signature.

The one genuine unknown is *not* about the SDK's surface but about how this repo will
consume it: whether `moduleResolution` gets bumped or the webhook helper gets
reimplemented by hand is a decision for whoever implements Task 6, not something knowable
from `node_modules` alone.
