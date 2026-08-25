# Architecture — ats-fit-backend

## Purpose

Describe what the system does for users and the main runtime boundaries.

## Context diagram

- **Actors**: (users, admins, other services)
- **External systems**: (payments, email, identity)
- **This repo**: (apps, packages, workers)

## Logical structure

| Area | Responsibility | Key modules |
|------|------------------|-------------|
| UI / API edge | Transport, validation at boundary | _TBD_ |
| Application | Use cases, orchestration | _TBD_ |
| Domain | Entities, invariants, policies | _TBD_ |
| Infrastructure | DB, queues, object storage, 3rd-party SDKs | _TBD_ |

## Data flow

1. Request/event enters at: _TBD_
2. Authoritative state lives in: _TBD_
3. Async work is handled by: _TBD_

## Key decisions

| Decision | Why | Tradeoff |
|----------|-----|----------|
| _TBD_ | _TBD_ | _TBD_ |

## Non-goals

- _List explicit out-of-scope items to prevent accidental coupling_

## Evolution

- Next likely split: _TBD_
- Deprecations: _TBD_

## Payment gateway abstraction

### Provider-neutral webhook events

`IPaymentGateway` (`src/modules/subscription/externals/interfaces/payment-gateway.interface.ts`)
is the only payment surface the rest of the app depends on. The current
implementation, `CreemPaymentGateway`, does two jobs no caller is allowed to
skip: verify the inbound webhook signature, and translate the provider's
payload into a `NormalizedWebhookEvent`
(`externals/interfaces/normalized-webhook-event.interface.ts`). Every
consumer downstream — `SubscriptionController`, `SubscriptionService`,
`PaymentHistoryService` — reads only that normalized shape and never touches
Creem's raw JSON. `CreemService` (`externals/services/creem.service.ts`) is
the sole file permitted to import the `creem` SDK; everything above it is
SDK-agnostic.

**Why:** the module has already swapped providers once (LemonSqueezy →
Creem, 2026-08). Normalizing at the gateway boundary means the next swap
touches one adapter, not every service that currently reasons about payment
state.

### Webhook ingress: verify → parse → claim → route

`POST /subscriptions/payment-confirmation` is `@Public()` and
internet-facing — signature verification is the entire security boundary
protecting it. The flow, in order:

1. **Verify** the raw request body against the header bag (two Creem
   signature schemes; scheme selection is deterministic, never "fall back to
   the weaker one"). Runs strictly before any DB read or write.
2. **Parse** into a `NormalizedWebhookEvent`. Never throws — an
   unrecognised event type becomes `PaymentEventType.UNKNOWN` rather than an
   exception, so a 200 is still possible for events this codebase doesn't
   act on.
3. **Resolve** the user from `event.metadata.user_id` (server-derived at
   checkout) and the plan once, reusing both for every step below.
4. **Claim.** A single conditional `UPSERT` against
   `payment_history.payment_gateway_transaction_id` (a `UNIQUE` constraint)
   atomically reserves the row before any handler runs, or recognises the
   delivery as a duplicate. No DB transaction spans the claim and the
   handler — the handler calls AWS SES, and holding a pooled connection
   across a network call would be false atomicity.
5. **Route** on event type, then mark the row processed only once the
   handler succeeds. An unhandled exception leaves the claim unfinished, so
   the provider's own retry schedule reprocesses the event.

### Cancellation is scheduled, not an event

Cancelling sets `is_cancelled = true` and `status = SCHEDULED_CANCEL` but
leaves `is_active` true — access is retained until the current billing
period ends. The downgrade happens only when a `subscription.expired`
webhook arrives. There is no immediate-cancellation code path.

Files of record:
- `src/modules/subscription/externals/interfaces/normalized-webhook-event.interface.ts`
- `src/modules/subscription/externals/gateways/creem-payment.gateway.ts`
- `src/modules/subscription/externals/webhooks/creem-webhook-verifier.ts`
- `src/modules/subscription/externals/webhooks/creem-webhook-parser.ts`
- `src/modules/subscription/services/payment-history.service.ts` (`claimPaymentEvent`)
- `src/modules/subscription/controllers/subscription.controller.ts` (`paymentConfirmation`)

## Resume tailoring pipeline

### Tech-substitution guardrail (resume optimization)

The resume optimizer applies a two-layer defense against the LLM substituting
technologies (e.g. swapping Angular for React because the JD asks for React):

1. **Prompt-side fence** — for every optimization request, the prompt includes
   an `EXPERIENCE_TECH_LOCK` section listing, per experience, the only
   technologies that may be named in that experience's bullets. The
   zero-hallucination policy is extended to forbid technology substitution
   explicitly (Class B alongside Class A numeric facts).

2. **Post-LLM scrubber** — `ResumeOptimizerService.scrubInventedMetrics` calls
   `ExperienceTechAllowlistService.detectForbiddenTokens` on every output
   bullet; any bullet that introduces a JD-driven tech token absent from the
   experience's allowlist is reverted to its source bullet and logged under
   `hallucinated_tech`.

The allowlist for experience [i] is built from `experience[i].technologies`
(comma-split) plus any candidate-wide skill that already appears verbatim in
that experience's responsibility bullets. JD-only technologies are
intentionally excluded — that exclusion is the guardrail.

3. **Skills lock (deterministic post-LLM replacement)** — the same Class B
   substitution problem leaks into `optimizedContent.skills` (adding JD-only
   tech like `.NET`, `C#`, `Azure` to a Node.js candidate and dropping their
   real skills). Because the skills field needs no LLM creativity,
   `ResumeOptimizerService.restoreSourceSkills` deep-clones the source
   candidate's skills and overwrites `optimizedContent.skills` verbatim after
   `scrubInventedMetrics` and before `validateNoExperienceDropped`. Any
   divergence between LLM output and source skills is logged under
   `hallucinated_skills` with structured `added` / `removed` payloads for
   drift monitoring. The prompt is also updated to instruct the LLM to echo
   skills unchanged.

Files of record:
- `src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts`
- `src/shared/services/prompt.service.ts` (`getOptimizationPromptParts`)
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts`
- `src/modules/resume-tailoring/prompts/examples/optimizer.examples.ts` (examples #4, #5)

### Match scoring (smarter scorer)

The `matchScoreBefore` / `matchScoreAfter` numbers reported per generation are
produced by `KeywordMatchScoringService`, a deterministic three-layer scorer
that replaces the previous literal-substring heuristic:

1. **Tokenization (Layer 1)** — flatten the candidate content, normalize
   (lowercase, strip punctuation, collapse hyphens / whitespace), tokenize and
   run an inline Porter-lite stemmer so morphological variants collapse
   (`leadership` → `leader` → `lead`, `optimizing` → `optimiz`). Per-phrase
   score is `matchedTokens / totalTokens`, with a +0.2 bigram bonus when two
   adjacent phrase tokens appear adjacently in the resume stream (capped at 1).
2. **Alias expansion (Layer 2)** — every JD keyword carries optional
   `aliases` (sourced from `jobAnalysis.keywords.synonyms`, with the
   orchestrator's `readJdAliases` helper normalizing both the canonical
   `[{term, alternatives}]` array and the legacy `{term: [...]}` map shape).
   Candidate-side aliases (`TailoredContent.skillAliases`) are emitted by the
   resume-extraction LLM and forwarded by the orchestrator into the scorer for
   both before- and after-scoring calls, making alias expansion symmetric on
   both sides (JD keyword aliases × candidate skill aliases). Legacy records
   without `skillAliases` continue to pass `undefined` and the scorer degrades
   gracefully.
3. **Universal safety net (Layer 3)** — a tiny hardcoded `UNIVERSAL_ALIAS_MAP`
   (~15 entries: k8s↔kubernetes, ci/cd↔continuous integration, etc.) catches
   well-known abbreviations the LLM alias step may have missed.

The JD-analysis prompt (`PromptService.getJobDescriptionAnalysisPrompt` and
`...PromptParts`) now emits per-keyword aliases under `keywords.aliases` in
the canonical `[{ term, alternatives }]` shape, with explicit instructions
to cover abbreviations, morphological variants, modifier-stripped variants,
hyphenation, and common reorderings for every primary keyword and mandatory
skill. `JobAnalysisService.normalizeAliases` parses either the new `aliases`
key or the legacy `synonyms` key (canonical array or legacy map) and
persists the canonical shape under both fields for one prompt-version
cycle, so Layer 2 of the scorer always has a populated alias set without
breaking pre-existing DB rows.

Resume extraction now emits per-skill aliases as well, under the canonical
`TailoredContent.skillAliases: [{ skill, alternatives }]` shape — the
extraction prompt (`PromptService.getResumeContentExtractionSystemPrompt`)
requires ≥2 alternatives per skill across `skills.languages | frameworks |
tools | databases | concepts`. The orchestrator forwards these into both
`computeScore` call sites so alias expansion is now symmetric on both
sides (JD keyword aliases × candidate skill aliases). The
`enrichedContent` / `originalContent` JSONB columns on
`enriched_resume_profiles` carry `skillAliases` along without a schema
migration, and `ResumeOptimizerService.restoreSourceSkills` deterministically
restores `skillAliases` from the source content alongside the skills lock
so any post-optimization drift is reverted.

Asymmetric scoring (Task A — match score unification): the `before` and
`after` scores deliberately use different scorer configurations to mirror
real ATS behaviour. The `before` score is computed against
`resumeContent.originalText` (the user's literal uploaded text — never
LLM-touched) with `computeScore(..., { applyAliases: false })`, which
bypasses the per-keyword JD aliases, the candidate-side `skillAliases`, and
the `UNIVERSAL_ALIAS_MAP`. Tokenization + Porter-lite stemming + bigram
bonus still apply (those are normalization, not aliasing). The `after`
score uses the full alias machinery against the structured optimized
content. `ChangesDiffComputationService.computeKeywordCoverage` is wired to
the same `KeywordMatchScoringService` via the orchestrator, so
`changes_diff.keywordAnalysis.coverageOriginal` / `coverageOptimized`
equal `match_score_before` / `match_score_after` (single engine, one number
per side).

The canonical `MatchScoreBlock` (`{ before, after, delta, improvementKind,
improvementMessage, statusColor }`) is the single output contract on every
API endpoint that returns generation data — single tailoring response,
batch tailoring SSE events, history list, history detail. The block is
derived once on the backend by `MatchScoreClassifierService.classify` (or
the static `classifyMatchScore` helper for plain-class call sites like
`resume-history.model.ts`) from `(before, after)` integers; frontends MUST
NOT reproduce these thresholds or compute deltas in templates. Order of
evaluation: `low-fit` (after < 40) → `already-strong` (before >= 80 &&
delta < 10) → `improved` (delta >= 10) → `flat` otherwise.

Files of record:
- `src/modules/resume-tailoring/services/keyword-match-scoring.service.ts` (`computeScore` with `applyAliases` option, static `buildKeywordSet`)
- `src/modules/resume-tailoring/services/match-score-classifier.service.ts` (`classify`, static `classifyMatchScore`)
- `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` (`computeScores`)
- `src/modules/resume-tailoring/services/changes-diff-computation.service.ts` (`computeKeywordCoverage` — single-engine path)
- `src/modules/resume-tailoring/interfaces/match-score-block.interface.ts`
- `src/modules/resume-tailoring/services/job-analysis.service.ts` (`normalizeAliases`)
- `src/shared/services/prompt.service.ts` (`getJobDescriptionAnalysisPrompt`, `getJobDescriptionAnalysisPromptParts`)
