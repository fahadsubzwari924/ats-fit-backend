export const VERB_TIERS = `<verb_tiers>
Choose action verbs appropriate to the candidate's seniority level:

L3–L4 (Junior/Mid IC): Built, Implemented, Developed, Configured, Fixed, Wrote, Added, Tested, Documented, Supported
L4–L5 (Senior IC): Designed, Refactored, Optimized, Automated, Reduced, Improved, Shipped, Debugged, Reviewed, Integrated
L5–L6 (Staff/Principal): Architected, Led, Established, Defined, Drove, Standardized, Mentored, Proposed, Evaluated, Consolidated
L6–L7 (Staff+/Management): Spearheaded, Transformed, Scaled, Founded, Grew, Championed, Oversaw, Directed, Strategized, Launched

Default to L4–L5 verbs unless the resume clearly signals higher seniority. All verbs must be past-tense for past roles; present-tense for current role responsibilities.
</verb_tiers>`;

export const BANNED_PHRASES = `<banned_phrases>
Never use these phrases or close variants:
passionate, results-driven, team player, hard-working, detail-oriented, go-getter, synergy, leverage (as verb), proven track record, dynamic, rockstar, ninja, guru, thought leader, game-changer, innovative, self-starter, proactive, highly motivated, strong communicator, excellent interpersonal skills
</banned_phrases>`;

export const NO_METRIC_FALLBACKS = `<no_metric_fallbacks>
When a source bullet lacks numbers and no user-verified fact applies, strengthen the bullet qualitatively using one of these fallback patterns instead of inventing metrics:

Scope fallback: reference the breadth of the work — "across 4 microservices", "spanning 3 engineering teams", "for a multi-tenant SaaS platform"
Named-entity fallback: ground in a specific technology, company stage, or known constraint — "for a Series-A fintech handling real-time payments", "within a regulated healthcare platform"
Comparative fallback: signal relative progress without inventing a number — "first in the org to ship X", "reduced from multi-step manual process to single command", "eliminated recurring production incidents"
Process fallback: describe the method or outcome in concrete terms — "by introducing contract testing", "through a structured incident review process", "enabling independent deployments per team"

Rules:
- Choose the pattern that best fits the original bullet's context
- Never combine multiple fallback patterns in the same bullet (prefer one clear angle)
- If none of the fallbacks fit, leave the bullet as a clean qualitative action-outcome statement
</no_metric_fallbacks>`;

export const TENSE_RULES = `<tense_rules>
Resume tense:
- Past roles: all bullets past-tense ("Designed", "Led", "Built") — no present-tense verbs for ended positions
- Current role responsibilities: present-tense acceptable ("Maintain", "Lead", "Own")
- Current role achievements: past-tense ("Reduced", "Shipped", "Launched")
Pronoun rules for resume:
- No first-person pronouns anywhere (no "I", "my", "we") — write in implicit first person (verb-first bullets)

Cover letter tense and pronouns:
- First-person pronouns OK and expected
- Never open with "I am writing to express my interest in…" or any close variant ("I would like to apply", "I am interested in applying", "Please accept this letter as my application")
- Open with a concrete achievement or a direct statement of fit
</tense_rules>`;

export const HOOK_PATTERNS = `<hook_patterns>
Choose one of these three opening hook patterns for the cover letter. Select based on the strongest available evidence in the resume:

Outcome hook (preferred when a measurable or concrete result exists):
"[Role] at [Company] to drive [key outcome from JD] — I [past achievement from resume with result]."
Example: "I joined Stripe's payments team at a time when latency was the top customer complaint; within six months our service cut p99 from 1.2s to 180ms."

Origin hook (use when a career-defining moment or pivot makes the fit story compelling):
"[Specific event or decision] is what turned me into a [domain] engineer — which is exactly why [Company]'s work on [specific initiative] caught my attention."
Example: "Debugging a memory leak at 2 a.m. that was costing $40k/month in cloud spend is what turned me into a systems-obsessed engineer — which is exactly why Cloudflare's edge-runtime work caught my attention."

Insight hook (use when the candidate has a non-obvious perspective on the domain):
"Most [role] engineers treat [common thing] as [conventional view]; I've found [contrarian but defensible insight from their resume experience]."
Example: "Most backend engineers treat API versioning as a backwards-compatibility problem; after migrating three major APIs at scale I've found it's primarily a team-coordination problem."

Rules:
- Pick exactly one hook pattern; do not mix elements from multiple patterns
- Every claim in the hook must trace to the resume or user-verified facts — no invented metrics
- Keep the hook to 2-3 sentences maximum
</hook_patterns>`;

export const TONE_CALIBRATION = `<tone_calibration>
Adjust tone to match the company context. Use the most specific signal available from the job description:

FAANG / large tech (Google, Meta, Amazon, Apple, Netflix, Microsoft):
- Terse, precise, achievement-led; minimal adjectives
- Lead with impact and scale; omit motivational language
- Avoid: "I am excited to", "I am passionate about", "I would love to"

Enterprise / Fortune 500 (finance, healthcare, consulting, manufacturing):
- Formal but not stiff; evidence-based over enthusiasm-based
- Acceptable to reference cross-functional scope and stakeholder management
- One sentence of genuine company-specific research is appropriate

Seed / Series-A startup:
- Direct, confident, slightly informal
- Emphasize ownership, speed, and full-stack thinking
- One sentence connecting to the company's specific problem or mission is expected

Default (unknown stage): use FAANG tone — terse and achievement-led.
</tone_calibration>`;

export const OPENER_ANTI_PATTERNS = `<opener_anti_patterns>
Never use any of these openers or close variants as the first sentence of the cover letter:
- "I am writing to express my interest in…"
- "I am writing to apply for the [role] position…"
- "I would like to apply for…"
- "I am interested in applying for…"
- "Please accept this letter as my application for…"
- "I am excited to apply for…"
- "I have always been passionate about…"
- "I am a highly motivated [role] professional…"
- "I am reaching out regarding the [role] opportunity…"
- Any sentence that starts with "I am" followed by a state-of-being verb (interested, excited, thrilled, pleased, eager)
Open with a hook from hook_patterns instead.
</opener_anti_patterns>`;

export const CONSTITUTIONAL_RUBRIC = `<constitutional_rubric>
Before emitting output, self-verify against every criterion below. Revise until all pass.
1. No invented facts or metrics — every number must trace to the source resume or USER-VERIFIED FACTS.
2. No dropped bullets — output responsibilities count per experience must equal input count exactly.
3. JSON schema compliance — response must deserialize against the output_schema without error.
4. Bullet length ≤22 words — count words in every responsibilities item; rewrite any that exceed the limit.
5. Zero banned phrases — scan every string value for terms in banned_phrases; replace any found.
6. Past-tense for past roles — all bullets under a role with a non-"Present" endDate must open with a past-tense verb.
</constitutional_rubric>`;
