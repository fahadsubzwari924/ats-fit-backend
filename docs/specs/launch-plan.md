---
doc_type: launch-plan
status: active
owner: Fahad Subzwari
last_reviewed: 2026-04-24
brand: Tailry
domain: tairly.com
coming_soon_launch: 2026-04-27
product_launch: 2026-05-26
---

# Tailry — 32-day launch plan (0 to 100)

> Operational launch playbook for the Tailry coming-soon landing relaunch (Apr 27, 2026) and full product launch (May 26, 2026). This document is the single source of truth for day-by-day tasks, content, metrics, and go/no-go gates.

## Executive summary

- **Brand:** Tailry (pivot from ATS Fit — `atsfit.app` is retired)
- **Domain:** `tairly.com` (registered Namecheap, ~$12/yr)
- **Coming-soon landing relaunch:** **Mon Apr 27, 2026** (soft launch, warm-network only)
- **Product launch:** **Tue May 26, 2026, 12:01 AM PST** (Product Hunt)
- **Beta:** friends/family starts Apr 26; stranger beta (from waitlist) starts May 12
- **Founding Rate:** First 100 waitlist signups lock Pro Monthly at $7.20/mo for life (40% off). Hard cap.
- **Referral system:** explicitly **out of scope** for coming-soon launch. Ships alongside product launch. Coming-soon uses email-only capture via Apps Script + Brevo.
- **Primary distribution channel:** LinkedIn (500+ existing connections). Secondary: Reddit (new account, 2-week karma-build window). Tertiary: BetaList + Product Hunt Coming Soon page.
- **Daily time budget:** 60 min/day realistic
- **Success floor:** 450+ confirmed waitlist signups by launch, 100/100 Founding redeemed within 7-day window, Top-5 Product Hunt finish

## Key dates

| Date | Day | Milestone |
|------|-----|-----------|
| Fri Apr 24 | D-32 | Plan finalized. Brand + domain locked. Weekend sprint starts. |
| Sat Apr 25 | D-31 | DNS + Brevo + landing redeploy to `tairly.com`. End-to-end email test. |
| Sun Apr 26 | D-30 | Friends/family beta invites go out. Mon announcement prepped. |
| **Mon Apr 27** | **D-29** | **COMING-SOON LANDING LIVE (soft launch).** LinkedIn announcement + 20 warm DMs. |
| Tue May 5 | D-21 | Backend NestJS waitlist module deployed, cutover from Apps Script. |
| Tue May 12 | D-14 | Brevo nurture email 1 sent. Stranger beta invites sent. First Reddit post. |
| Fri May 15 | D-11 | First testimonials from beta collected. |
| Tue May 19 | D-7 | Testimonials live on landing. 2nd Reddit post. PH assets drafted. |
| Sat May 23 | D-3 | **GO/NO-GO CHECKLIST (hard gate).** Brevo nurture email 2 sent. |
| Sun May 24 | D-2 | Rest day. DM list locked. |
| Mon May 25 | D-1 | PH assets uploaded as drafts. Launch emails scheduled in Brevo. |
| **Tue May 26** | **D-0** | **PRODUCT LAUNCH.** PH 12:01 AM PST + waitlist blast + LinkedIn. |
| Mon Jun 2 | D+7 | Founding 7-day window closes. Extend to 14 days if <90% claimed. |
| Mon Jun 22 | D+27 | Post-launch retrospective. Month-1 metrics review. |

---

## Phase 0 — Weekend foundation (Fri Apr 24 – Sun Apr 26, 3 days, ~12 hr)

### Goal

Land the brand change, wire DNS + Brevo for deliverability, make the landing page live on `tairly.com` with basic email capture working, prep Monday's announcement.

### Fri Apr 24 evening (3 hr)

**Task 0.1 — Update landing page content to new brand (90 min)**
- Global find/replace in `ats-fit-coming-soon-landing/` repo: `ATS Fit` → `Tailry`, `atsfit.app` → `tairly.com`, `hello@atsfit.app` → `hello@tairly.com`
- Update all OG tags, canonical URLs, meta titles, structured data (JSON-LD), favicon reference
- Update README.md in the repo
- Commit: `chore: rebrand ATS Fit → Tailry for Apr 27 launch`

**Task 0.2 — Set up Cloudflare Registrar / Namecheap DNS (30 min)**
- Move `tairly.com` nameservers to Cloudflare (free + fastest DNS globally). Alternative: keep at Namecheap DNS if allergic to Cloudflare.
- Add records:
  - `A` apex → Cloudflare Pages IP (once deployed)
  - `CNAME www` → apex
  - `MX` → Brevo's inbound MX records (even if no custom mailbox — signals proper domain)
  - Leave SPF/DKIM/DMARC empty for now; set in Task 0.5

**Task 0.3 — Create Brevo account (30 min)**
- Sign up at brevo.com, free tier
- Add sender: `hello@tairly.com` + `Tailry` display name
- Create single contact list: `Waitlist`
- Do NOT upload contacts yet — will happen via API from Apps Script

**Task 0.4 — Schedule weekend tasks (30 min)**
- Review Sat + Sun task list (below)
- Block calendar 3 hr Sat, 3 hr Sun

### Sat Apr 25 (4 hr)

**Task 0.5 — Email deliverability auth (90 min) — CRITICAL BLOCKER**
- In Brevo → Senders & IP → Domains → Add `tairly.com`
- Brevo generates SPF + DKIM records → paste into Cloudflare/Namecheap DNS:
  - SPF `TXT @` → `v=spf1 include:spf.brevo.com ~all`
  - DKIM `TXT mail._domainkey` → (Brevo-provided string)
  - DMARC `TXT _dmarc` → `v=DMARC1; p=none; rua=mailto:hello@tairly.com`
- Wait for propagation (~10 min to 2 hr)
- Verify each record in Brevo → all three must show ✓
- Test at **mail-tester.com**: send test email from Brevo to the score address → must score **9+/10** before proceeding. Below 9 → fix before Mon launch (usually DMARC alignment issue).

**Task 0.6 — Deploy landing page to `tairly.com` (60 min)**
- Cloudflare Pages: connect repo → deploy
- Add custom domain `tairly.com` + `www.tairly.com`
- Redirect `www` → apex (or vice versa; pick apex to match `canonical`)
- Force HTTPS (Cloudflare auto-provisions SSL)
- Hit `https://tairly.com` → verify landing renders correctly
- Test waitlist form submit → should still land in existing Google Sheet (Apps Script unchanged yet)

**Task 0.7 — Brevo confirmation email template (60 min)**
- In Brevo → Templates → create `waitlist_confirmation`
- Subject: `Confirm your spot on the Tailry waitlist`
- Body (use Brevo's template editor, no custom HTML needed):
  ```
  Hi there,
  
  Thanks for joining the Tailry waitlist. One last step —
  click below to confirm your email and lock in your spot.
  
  [Confirm my spot] button → link to thanks.html with the token
  
  Launching Tuesday, May 26, 2026.
  First 100 signups lock Pro at $7.20/mo for life.
  
  — Fahad
  Founder, Tailry
  ```
- Save template. Note the template ID for Apps Script to reference.

**Task 0.8 — Modify Apps Script to call Brevo (30 min)**
- In `apps-script/WaitlistWebApp.gs`:
  - Add `BREVO_API_KEY` to script properties (File → Project properties → Script properties)
  - Add `BREVO_TEMPLATE_ID_CONFIRMATION` and `BREVO_LIST_ID_WAITLIST`
  - In `doPost`, after successful `appendRow`, call Brevo API:
    1. `POST https://api.brevo.com/v3/contacts` → add email to list
    2. `POST https://api.brevo.com/v3/smtp/email` with `templateId` → fires confirmation email
  - On Brevo API error: still return `{ ok: true }` to the user, log error to a separate sheet column. Don't block the signup.
- Test with a real email signup → confirmation email arrives in ~30 sec.

### Sun Apr 26 (5 hr)

**Task 0.9 — Friends/family beta kickoff (60 min)**
- Pick 5 close friends + 3 family members who are active job-seekers or recently hired
- Create their accounts on the production product manually (or give them access however the product works currently)
- Send personal message: "I'm shipping Tailry in a month. Would love 10 min of feedback on real use this week — would you help me test?"
- Set up feedback collection: shared Notion doc OR a Brevo form. Keep it simple — 3 questions: "What works?", "What frustrated you?", "Would you pay $12/mo for this?"

**Task 0.10 — End-to-end deliverability test (30 min)**
- Sign up 3 fresh Gmail accounts at `tairly.com`
- Confirm: email lands in **Inbox** (not Promotions, not Spam)
- Confirm: `/thanks` page loads correctly
- If any email hits Spam → stop. Fix DMARC/DKIM before Mon.

**Task 0.11 — LinkedIn profile refresh (30 min)**
- Change headline: `Founder, Tailry · AI resume tailoring launching May 26`
- Update About section: 2-3 sentence version of the Tailry pitch + `tairly.com` link
- Change banner image: simple Canva banner with Tailry logo + tagline "Tailor your resume in 60 seconds"
- Do **not** announce the brand change yet — save for Mon

**Task 0.12 — Prep Mon announcement assets (90 min)**
- Write the Mon LinkedIn post (use template in Appendix A). Personalize the hook to your story.
- List 20 warm-network contacts to DM Mon morning (existing LinkedIn connections who are in job-seeker space, recruiters, career coaches, ex-colleagues)
- Write 3 DM template variants (see Appendix A.3) so you don't send identical messages
- Queue 2 follow-up LinkedIn posts for Tue and Wed (1 "demo" short post, 1 "why I built this" reflection)

**Task 0.13 — Final weekend check (30 min)**
- Landing live + redirects clean ✓
- Signup works end-to-end ✓
- mail-tester.com 9+/10 ✓
- Friends/family have access ✓
- Mon assets ready ✓
- You can sleep peacefully Sunday night

---

## Phase 1 — Soft launch week (Mon Apr 27 – Sun May 3, 7 days)

### Goal

Put landing in front of warm network. Target **30–60 signups** from no paid channels. Continue friends/family beta. Begin NestJS backend waitlist module.

### Mon Apr 27 — SOFT LAUNCH DAY

- **9:00 AM local** — Final check: landing live, form works, confirmation emails arriving (send yourself one test signup). If anything red → fix or delay 24 hr.
- **10:00 AM local** — Post the LinkedIn announcement (Appendix A.1)
- **10:30 AM – 2:30 PM** — Send 20 warm-network DMs in 4 batches of 5 (spread across 4 hours to look organic, not bot-like). Personalize every opener.
- **3:00 PM – 5:00 PM** — Respond to every comment on the LinkedIn post within 15 min. Respond to every DM reply same-hour.
- **End of day** — Log signups count in a simple `growth.md` file: date, signups, sources (X post? DM reply? Warm network forward?)

### Tue Apr 28 – Fri May 1 (daily ~75 min)

**Daily template:**
- 15 min: Check signups, Brevo analytics (delivery rate, open rate of confirmation), reply to any new DMs/comments
- 30 min: Backend NestJS waitlist module work (see spec 11). Sequence:
  - Day 1 (Tue): Entity + migration + basic signup endpoint
  - Day 2 (Wed): Brevo service wrapper + confirmation flow
  - Day 3 (Thu): `/count` + `/stats` endpoints
  - Day 4 (Fri): Admin endpoints + basic tests
- 30 min: LinkedIn content (alternate short posts + long-form):
  - Tue: short post "Day 1 of public Tailry build: 22 signups overnight. Thanks to everyone who joined." + screenshot of live counter
  - Wed: short post "Here's what Tailry does in 60 seconds" + embed the 12-sec demo video from landing
  - Thu: short post: "Why I built Tailry — the 45-min-per-application moment" (founder story flavor)
  - Fri: long-form article (see topics in Appendix B)

### Sat May 2 – Sun May 3 (weekend ~90 min)

**Task 1.5 — Friends/family beta feedback review (60 min Sat)**
- Collect feedback from 3–5 beta testers who actually used the product
- Identify top 3 bugs and top 3 pain points
- Log to `beta-feedback-round-1.md` in repo
- Decide: fix all bugs this week, or push non-blockers to post-launch?

**Task 1.6 — Backend polish + prep for cutover (60 min Sun)**
- Complete remaining tests on waitlist module
- Write one-shot migration script: export Google Sheet → import rows into `WaitlistEntry` table, preserving `created_at` and `signup_order`

### Phase 1 exit criteria

- [ ] Landing page live and stable, zero deliverability issues
- [ ] 30+ confirmed signups
- [ ] Backend waitlist module feature-complete on staging
- [ ] Friends/family beta producing feedback
- [ ] 4 LinkedIn posts shipped, average >3 reactions each
- [ ] `growth.md` started with daily logging habit

---

## Phase 2 — Quiet build (Mon May 4 – Sun May 10, 7 days)

### Goal

Cutover waitlist backend from Apps Script to NestJS. Submit to BetaList + Product Hunt Coming Soon. Begin Reddit karma build (no posting). Ship landing F1 counter + F2 optional fields. Target cumulative **80+ signups**.

### Mon May 4 (75 min)

**Task 2.1 — NestJS backend cutover (45 min)**
- Deploy waitlist module to production. Update Cloudflare Pages env var `WAITLIST_BACKEND_URL` (replacing `WAITLIST_GAS_URL`).
- Run migration script: Google Sheet rows → `WaitlistEntry` table. Preserve signup_order.
- Disable Apps Script doPost (return 410 Gone if called — defensive).
- Submit one test signup to verify end-to-end on new infra.

**Task 2.2 — LinkedIn short post (15 min)**
- "Week 2 of public Tailry build: 42 signups. 58 more until Founding Rate is gone."
- Screenshot the live counter

**Task 2.3 — Reddit karma seed (15 min)**
- Create Reddit account (if not already). Choose a username that doesn't reveal the brand (e.g. your first name + random digits)
- Subscribe to: r/jobs, r/cscareerquestions, r/resumes, r/recruitinghell, r/engineeringresumes, r/careerquestions
- Spend 15 min commenting — helpful, non-promotional answers on recent posts

### Tue May 5 (60 min)

**Task 2.4 — BetaList submission (30 min)**
- Go to betalist.com/submit. Free or paid ($129 for priority) — paid gets you featured in 3–7 days vs 30+ for free. Recommend **paid** given the tight window.
- Title: `Tailry — Tailor your resume to any job in 60 seconds`
- Submit with tairly.com URL, 3 screenshots, 60-sec demo GIF

**Task 2.5 — Product Hunt Coming Soon page (30 min)**
- producthunt.com/products/new
- Create product page: tagline, tags (resume, AI, career, productivity), screenshots
- Schedule "launch date" for Tue May 26
- Mark "Upcoming" so it appears in the Coming Soon feed
- Share PH URL in a fresh LinkedIn short post

### Wed May 6 – Fri May 8 (daily ~75 min)

- 15 min: signups check, inbox, analytics
- 30 min: Landing page F1 (unhide counter) + F2 (optional fields — job_search_status + biggest_pain) — both ship to prod by Fri
- 15 min: Reddit engagement (no posts yet, only comments, accumulate 50+ karma)
- 15 min: LinkedIn content:
  - Wed: short post with an interesting stat from the 12-sec demo
  - Thu: short post with friends/family beta quote (ask permission first)
  - Fri: long-form article #2

### Sat May 9 – Sun May 10 (weekend ~90 min)

**Task 2.6 — Stranger beta candidate selection (60 min Sat)**
- Query waitlist DB: pick 10 highest-engagement candidates
  - Priority 1: confirmed + referred someone (won't happen yet since no referral — skip)
  - Priority 2: confirmed + early signup_order
  - Priority 3: confirmed + completed both optional fields (job_search_status + biggest_pain)
- Draft the beta invite email (Appendix C.1)

**Task 2.7 — Backend referral module planning (60 min Sun)**
- Read `ats-fit-backend/docs/specs/11-waitlist-and-referral.md`
- Plan the ~14 hr of referral implementation across May 11–15 (mostly evenings)
- Identify which ACs are blocker for launch (referral_code generation, increment on confirm, stats endpoint, leaderboard endpoint) vs nice-to-haves (Brevo webhook, admin endpoints — can ship post-launch)

### Phase 2 exit criteria

- [ ] Backend fully cut over from Apps Script → NestJS. Apps Script retired.
- [ ] 80+ confirmed signups
- [ ] BetaList + Product Hunt Coming Soon submissions live
- [ ] Landing F1 counter unhidden + F2 optional fields shipped
- [ ] Reddit account 50+ karma from comments
- [ ] 4 more LinkedIn posts shipped

---

## Phase 3 — Distribution ignites (Mon May 11 – Sun May 17, 7 days)

### Goal

Referral system shipped. First Reddit posts. Stranger beta recruits. First Brevo nurture email to waitlist. Target cumulative **200+ signups**.

### Mon May 11 (90 min — heavier day)

**Task 3.1 — First Reddit post (45 min)**
- Subreddit: **r/jobs** or **r/cscareerquestions** (pick based on your fit; r/jobs is more general, r/cscareerquestions is high-traffic tech-specific)
- Post format: **value-first, not promo** (see Appendix D.1 for template)
- Title: "I spent a year rewriting my resume for every job. Here's what I learned about what actually gets past ATS filters."
- Body: 400–600 words of genuine value (tips on keyword matching, single-column formatting, bullet action-verbs, skill ordering). Mention Tailry **only once** at the end, casually: "I ended up building a tool that does this in 60 seconds — tairly.com if curious. But the principles above work without any tool."
- Post Mon morning 9–10 AM ET (peak Reddit traffic for jobs-related subs)
- Monitor for 4 hours, reply to every top-level comment

**Task 3.2 — LinkedIn long-form article (30 min)**
- Topic: "Why the first 100 signups on Tailry get Pro for $7.20/mo for life"
- Walks through the Founding Rate reasoning as a business-model post (scarcity, loss-aversion, why it's not a gimmick). Builds credibility + urgency in one post.

**Task 3.3 — Signups + Reddit monitoring (15 min)**

### Tue May 12 (75 min)

**Task 3.4 — Stranger beta invites (30 min)**
- Send Appendix C.1 email to 15 highest-engagement waitlist entries
- Give them a coupon code for 30-day free Pro (create via Creem dashboard)
- Expected yes rate: 50–60% → 8–10 acceptances

**Task 3.5 — Referral system backend shipping (45 min)**
- Deploy first portion: referral_code generation on signup, `referred_by` capture from URL param, stats endpoint
- Test end-to-end: signup with `?ref=xxx` → captured correctly → visible in stats

### Wed May 13 (75 min)

**Task 3.6 — Brevo nurture email 1 — "Behind the scenes" (30 min to compose, send at 10 AM local)**
- Audience: all confirmed waitlist entries
- Content: short, founder-voice. See Appendix C.2.
- CTA: visit `/thanks` to see their referral link (new!) and share it
- Track: open rate (target >40%), click rate (target >15%)

**Task 3.7 — Landing `/thanks` rebuild (45 min)**
- Add referral link display, simple progress bar, share buttons
- Ship to prod

### Thu May 14 – Sun May 17 (daily ~60 min, lighter weekend)

- Daily: signups + Reddit reply + inbox (15 min)
- Thu: short LinkedIn "85/100 Founding slots claimed" milestone post (if actually true; be honest)
- Fri: Long-form article — "I built Tailry solo in 4 months — here's the entire stack" (indie-hacker flavor, often viral on LinkedIn in 2026)
- Sat: Collect first feedback from stranger beta testers (day 4–5 of their trial)
- Sun: Testimonial ask to any beta tester who gave positive feedback (Appendix C.4)

### Phase 3 exit criteria

- [ ] Referral system live, receiving referrals
- [ ] 200+ confirmed signups
- [ ] First Reddit post published, target 200+ upvotes OR 50+ comments
- [ ] Stranger beta 8+ testers active
- [ ] Brevo nurture email 1 sent, open rate >40%
- [ ] First 2 testimonials collected (even if not on landing yet)

---

## Phase 4 — Testimonials + amplification (Mon May 18 – Fri May 22, 5 days)

### Goal

Collect testimonials and put them on landing by Thu May 22. Second Reddit post. Produce PH launch assets. Target cumulative **350+ signups**.

### Mon May 18 (60 min)

**Task 4.1 — Testimonial ask batch (30 min)**
- Send Appendix C.4 to all beta testers who gave positive Q1/Q3 feedback
- Expected: 5–7 yes replies

**Task 4.2 — PH launch gallery (30 min)**
- 5 product screenshots: hero view, upload flow, tailoring in progress, diff view, pipeline view
- 1 animated GIF of 60-sec tailoring (extract from existing demo webm)
- Draft tagline: "Tailor your resume to any job in 60 seconds"
- Draft first Maker Comment (Appendix E.1)

### Tue May 19 (75 min)

**Task 4.3 — Second Reddit post (45 min)**
- Different subreddit from Mon May 11's. Recommend **r/resumes** (high intent) or **r/recruitinghell** (very high engagement, different angle — lean into the pain)
- Title: "After 6 months of job hunting, here's the single thing that changed my callback rate"
- Body: genuine story, value-first, tool mention casual at end. See Appendix D.2 for template.

**Task 4.4 — LinkedIn short post (15 min)**
- Milestone: "One week to launch. 340 on the waitlist. 18 Founding slots left."

**Task 4.5 — Testimonials collection (15 min)**
- Log every "yes" from Mon's ask into a sheet
- Follow up with anyone who hasn't replied by end-of-day

### Wed May 20 (75 min)

**Task 4.6 — Put testimonials on landing page (60 min)**
- 4–5 testimonials with first name, last initial, role, LinkedIn link (if consent given), photo (Cloudinary-host their LinkedIn profile pic with their permission)
- Add new section between Diff proof and Comparison table on landing, labelled "Beta users talking"
- Ship to prod. Verify mobile layout.

**Task 4.7 — LinkedIn short post (15 min)**
- "Just added 5 beta testimonials to tairly.com — real people who used the product during beta. Honest reactions, no prompts."

### Thu May 21 (75 min)

**Task 4.8 — Long-form article (45 min)**
- Topic: "5 beta testers, 5 brutally honest reactions" — quote the testimonials, including any mixed ones. Builds authenticity.

**Task 4.9 — PH launch assets finalized (30 min)**
- Upload gallery + GIF as drafts to the PH Coming Soon page
- Second Maker Comment drafted (for after launch, at ~6 hr mark)
- Confirm tagline, topics, subcategory

### Fri May 22 (60 min)

**Task 4.10 — Final week preflight (30 min)**
- Read through the whole landing page as a fresh visitor. Any broken links? Typos? Tone issues?
- Test: sign up as a brand-new user → confirmation email → click → `/thanks` with referral link → share to X → URL pastes correctly
- Fix anything janky. No new features.

**Task 4.11 — Launch-day DM list (30 min)**
- Create `launch-day-dm-list.md` with 20–30 people
- Personalize opener for each (what you remember about them, why you'd tell them specifically)
- Save these as draft messages in LinkedIn → you just click-send on launch morning

### Phase 4 exit criteria

- [ ] 4+ testimonials live on landing page
- [ ] 350+ confirmed signups
- [ ] 2nd Reddit post published
- [ ] PH launch gallery + Maker Comment drafts uploaded
- [ ] Launch-day DM list finalized and saved as drafts
- [ ] 5 more LinkedIn posts shipped

---

## Phase 5 — Launch crescendo (Sat May 23 – Mon May 25, 3 days)

### Goal

Pass the T-3 go/no-go gate. Send final nurture email. Rest. Launch rock-ready by Mon night.

### Sat May 23 — T-3 GO/NO-GO CHECKLIST (hard gate, 2–3 hr)

Run through every item below. **Any red → consider delaying launch by 7 days (to Tue Jun 2).**

#### Deliverability
- [ ] mail-tester.com score >= 9/10 on a fresh test email from Brevo
- [ ] SPF, DKIM, DMARC all green in Brevo domain authentication
- [ ] No bounce rate >2% in Brevo dashboard over last 14 days

#### Backend
- [ ] Waitlist signup endpoint: 100-concurrent load test passes without timeouts (run via `k6` or `oha`)
- [ ] Referral system: 3-tester end-to-end test passes (A refers B, B confirms, A's count increments)
- [ ] Founding Rate checkout: staging test with real Creem discount code → real webhook → user's `founding_rate_locked` set to true, `$7.20/mo` price honored
- [ ] Webhook idempotency: double-fire same webhook → no duplicate subscriptions
- [ ] Core tailoring: P95 latency <30s over 100 real runs (sample from real usage logs)

#### Product
- [ ] Happy path signup → onboarding → first tailoring works end-to-end in production
- [ ] Free tier works without credit card
- [ ] Pro checkout with Founding code works
- [ ] Email confirmation emails arriving in **Inbox** (not Promo, not Spam)

#### Content + assets
- [ ] PH page: gallery, GIF, tagline, first Maker Comment ready
- [ ] 4+ testimonials live on landing
- [ ] Launch-day LinkedIn post written
- [ ] Launch-day DMs in LinkedIn drafts folder (20–30)
- [ ] Brevo launch-day email scheduled for 9 AM user-local Tue May 26

#### Ops
- [ ] Monitoring dashboards up (DB, API error rate, Brevo send success)
- [ ] Creem alerts to your phone for any webhook failure
- [ ] You have caffeine and food for Mon night (launch is 12:01 AM PST Tue = midnight PST, your local time likely evening Mon)

#### Nurture email 2
- [ ] Brevo email 2 composed (Appendix C.3) and scheduled for Sat May 23 10 AM local. Sends *today*.

**If any item is red and can't be fixed by Mon May 25 EOD:** post-pone launch to Tue Jun 2. Announce to waitlist via a "launch delay — quality over speed" email. Better to delay once than launch broken and burn your one shot at attention.

### Sun May 24 — REST DAY

- No product code changes
- No new LinkedIn posts
- Take a walk. Sleep 8 hours.
- Evening: Re-read Appendix E (launch-day runbook). Visualize launch morning.

### Mon May 25 (90 min)

**Task 5.1 — Schedule everything for Tuesday (60 min)**
- Brevo email 3 "Launch day — your code is here": compose, schedule for **Tue May 26 9 AM user-local** (Brevo supports time-zone-aware sends). See Appendix C.5.
- PH page: flip from "Coming Soon" to "Launching Tomorrow" (PH has this state)
- LinkedIn: draft launch-day post, save as draft (will post Tue ~6 AM PST / whatever your local morning is)
- Queue 2 LinkedIn follow-up posts for Wed + Thu

**Task 5.2 — Final communications (20 min)**
- Email friends/family beta group: "Thank you — launching tomorrow. Would love if you upvoted on Product Hunt at launch. Link will be in tomorrow's email."
- Send 3 personal "heads up" DMs to your most-engaged LinkedIn connections asking them to watch for the launch post

**Task 5.3 — Mental prep (10 min)**
- Reread your launch-day runbook (Appendix E)
- Set alarm for 5:30 AM local (if 12:01 AM PST falls mid-evening local time — adjust accordingly)
- Launch happens **Tue May 26 at 12:01 AM PST**

### Phase 5 exit criteria

- [ ] All go/no-go items green (or launch delayed honestly)
- [ ] Nurture email 2 sent Sat
- [ ] Everything for Tue scheduled
- [ ] You're rested

---

## Phase 6 — LAUNCH DAY (Tue May 26, 2026)

Launch goes live at **12:01 AM PST** (Tue, which is **12:31 PM Pakistan Standard Time** given GMT+5 = +13h from PST). Adjust your local schedule accordingly.

### Hour 0 (12:01 AM PST / afternoon–evening your time)

- PH Coming Soon page auto-flips to LIVE
- Verify live on producthunt.com/posts/tairly
- Post your Maker Comment (Appendix E.1) within 5 minutes
- First tweet/LinkedIn post: "We're live on Product Hunt: [link]"

### Hours 0–2 (critical first-hour velocity)

- Send the 20–30 DM-draft messages via LinkedIn: **all at once, not throughout the day**. First-hour PH algorithm weights velocity.
- Monitor PH upvote count every 15 min
- Reply to every PH comment within 15 minutes. This is not optional.
- Post LinkedIn launch announcement (Appendix A.5)

### Hours 2–8

- Brevo email 3 fires to waitlist at their local 9 AM (staggered globally)
- Monitor dashboards — Brevo deliverability, PH ranking, signup rate, Stripe/LS webhooks
- Respond to every inbound channel: LinkedIn DMs, PH comments, emails, any Reddit mentions

### Hours 8–24

- Post 2nd Maker Comment at ~hour 8 (reframe, add social proof from the day)
- Second LinkedIn post "Update: [stats]" at ~hour 12
- Last push: "Product Hunt closes in 4 hours — thanks everyone who upvoted" at ~hour 20

### End of day logging

- Update `growth.md` with hour-by-hour PH rank, signups, conversions

### Launch day targets

| Metric | Floor | Target | Stretch |
|--------|-------|--------|---------|
| PH rank at end of day | Top 10 | **Top 5** | Top 3 |
| New signups | 200 | **400** | 600+ |
| Pro subscriptions (Founding Rate) | 30 | **60** | 100 |
| LinkedIn launch post reactions | 50 | 150 | 300+ |

---

## Phase 7 — Launch week (Wed May 27 – Mon Jun 2, 7 days)

### Goal

Close Founding redemption window. Customer support. Begin retention measurement. Target cumulative **180+ Pro subscriptions** by end of week.

### Wed May 27 – Fri May 29

**Daily template (~90 min):**
- 30 min: Customer support (refunds, bug reports, questions). Every reply within 4 hours max.
- 15 min: LinkedIn milestone post ("Day 2 of launch: [stat]") — daily during launch week
- 15 min: Respond to any lingering PH/Reddit/LinkedIn comments
- 30 min: Bug triage — critical fixes only. No features.

### Sat May 30 — Sun May 31 (light weekend)

- Check Founding redemption counter. If <80/100 by Sat EOD, prepare to extend the 7-day window.
- Long-form LinkedIn article: "Tailry launch recap — what worked, what didn't" — honest numbers drive shares

### Mon Jun 1 — Founding window extension decision

- If 100/100 redeemed → celebrate, close the Founding chapter, lock Pro pricing at $12/mo standard
- If <100 redeemed → announce extension to **14 days** total (i.e. window closes Jun 9 instead of Jun 2). Email waitlist: "A few Founding slots are still open — extending redemption by one week."

### Tue Jun 2 — Original Founding window close

- If extended, skip. If not extended, lock the Founding count.

### Phase 7 targets

| Metric | Floor | Target |
|--------|-------|--------|
| Pro subs total | 100 | **180+** |
| Founding slots redeemed | 80 | **100 / 100** |
| Refund rate | <5% | **<2%** |
| Churn in first 7 days | <15% | **<8%** |

---

## Phase 8 — Post-launch measurement (Jun 3 – Jun 22, 20 days)

### Goal

Measure honest retention. Fix urgent issues. Decide next growth lever.

### Weekly cadence

- **Week 1 post-launch (Jun 3–9):** bug fix sprint. Pause all content. Customer support prioritized. First retention data visible by end-of-week.
- **Week 2 (Jun 10–16):** return to content cadence (2 LinkedIn posts/week). Start measuring Pro month-2 conversion signals.
- **Week 3 (Jun 17–22):** Month-1 retrospective. Write `post-launch-retrospective.md`. Decide next growth initiative.

### Month-1 targets (by Jun 26)

| Metric | Floor | Target |
|--------|-------|--------|
| Cumulative Pro subscriptions | 250 | **350+** |
| Month-2 retention (users who hit billing cycle 2) | 20% | **30%+** |
| Waitlist → Pro conversion rate | 25% | **35%+** |
| NPS (from exit surveys) | 30 | **50+** |

---

## Success metrics dashboard

Track these in a single `growth.md` file, updated daily at 10 PM local time:

```
## YYYY-MM-DD
- Waitlist signups: N (cumulative), +X (day)
- Confirmed: N (%)
- Referral signups: N (%)
- Founding slots remaining: N
- LinkedIn: X posts, Y total reactions
- Top post today: [link, reactions, comments]
- Notable DM/comment: [quote]
- Bugs/issues: [list]
- Tomorrow priority: [task]
```

### Weekly review checkpoints (Sun evening, 30 min)

- Are we on track for 450+ signups by May 26? (If behind by >20% at any checkpoint, add one more distribution play)
- Is confirmation rate >70%? (If below, deliverability problem — investigate Brevo bounce/spam reports)
- Are LinkedIn posts getting >3 reactions? (If below, revisit hook/topic selection)

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Brevo deliverability drops mid-window | Medium | High | mail-tester.com weekly; monitor Brevo bounce rate; have SES fallback ready (already installed for payment-failed emails) |
| First Reddit post gets removed as promo | Medium | Medium | Lead with 400+ words of genuine value; mention tool once casually at the end; if removed, learn and retry different sub |
| Founding 100 slots don't fill | Medium | Medium | Extend redemption window to 14 days; push "slots remaining" in every email + LinkedIn post |
| Critical bug surfaces during launch week | Medium | High | T-3 go/no-go gate catches most; if bug surfaces post-launch, hotfix within 4 hr + transparent launch-week update post |
| PH launch flops (rank >15) | Medium | Medium | Prepared for self-hunt (no dependency on external hunter); plan B is relaunch with warmer audience at T+14 as "V2" — not ideal but workable |
| Beta testers won't give testimonial permission | Low | Medium | Have 3 backup testimonials from friends/family beta; ask 10 stranger-beta, need 5 yes = 50% rate is fine |
| Backend waitlist module not done by May 5 | Medium | High | Referral features are deferred to May 11–15 anyway; core signup just needs to be migrated by May 5. If NestJS delayed, Apps Script keeps running (no hard cutover forced) |
| Competitor copies Founding Rate in next 32 days | Low | Low | Not worth defending — execute better instead |

---

## Assets inventory

### Already exists
- ✅ Landing page built, deployed to `atsfit.app` (needs domain/brand swap)
- ✅ 12-sec demo video (`ats_fit_demo_new.webm`)
- ✅ Diff proof screenshot (`changes_diff.png`)
- ✅ OG image (needs rebrand)
- ✅ Existing Google Sheet waitlist (must migrate)
- ✅ Apps Script + Cloudflare Function proxy
- ✅ Backend spec for waitlist + referral (`11-waitlist-and-referral.md`)

### Must produce in Phase 0 (weekend)
- Brevo confirmation email template
- DNS + email auth for tairly.com
- Landing page re-deployed to tairly.com

### Must produce in Phases 1–4
- NestJS waitlist module (spec 11)
- Referral UI on `/thanks`
- 4–5 testimonials (Phase 4)
- PH launch gallery (5 screenshots + 1 GIF)
- 3 Brevo nurture emails
- 20+ LinkedIn posts
- 2 Reddit posts
- 2 long-form articles/week (total ~10 over 4 weeks)

---

## Appendix A — LinkedIn content templates

### A.1 Mon Apr 27 soft-launch announcement post

```
For two years I've watched friends spend 30+ minutes
rewriting their resume for every single job — or give up
and send the same version for 50 applications.

Today I'm putting Tailry on the map.

Tailry tailors your resume to any job description in under
60 seconds. Cover letter from the same context. Every
application tracked in one pipeline.

Launching May 26, 2026.

The first 100 waitlist signups lock Pro at $7.20/mo for
life — 40% off the standard price, locked across cancel/
resume cycles for every future job search.

Cap is real. 100 only. No marketing number.

tairly.com

If you're job-hunting or know someone who is, this might
be useful. Either way, I'd love to hear what you think.
```

### A.2 Tue Apr 28 — Day 1 signups post (short)

```
Day 1 of public Tailry build.

[N] signups overnight. Thank you to everyone who joined.

Founding slots remaining: [100-N]
Launch: May 26.

tairly.com
```

### A.3 Warm-network DM templates (rotate 3 versions)

**Version 1 (professional, for ex-colleagues):**
```
Hey [name] — quick heads up. I've been building Tailry
for the past few months, a tool that tailors resumes
to job descriptions in 60 seconds. Launching May 26.
Giving the first 100 waitlist signups $7.20/mo for life
(40% off).

Not asking you to sign up — genuinely want your eyes
on the landing page. Is the pitch clear? Would love 30
seconds of your reaction: tairly.com
```

**Version 2 (casual, for close friends):**
```
[name] — shipping the thing I've been building for a
while. Launching May 26. Would mean a lot if you took
a look at tairly.com and told me if the pitch lands or
feels off. No signup pressure.
```

**Version 3 (for recruiters / career coaches):**
```
Hey [name] — you've been in the job-search world for a
while. Building Tailry — tool for candidates to tailor
resumes + track applications + generate cover letters
in one place. Launching May 26.

Would love your read on whether this solves a real pain
you see with candidates. tairly.com
```

### A.4 Short post templates (mix and match through the window)

- Milestone: "[X]/100 Founding slots claimed. Launch May 26."
- Demo: "Tailry in 60 seconds: [embed demo video]"
- Founder story: "The moment I realized I needed to build Tailry: [specific anecdote]"
- Behind-the-scenes: "Spent today wiring [specific feature]. Here's why it matters: [2-3 sentences]"
- Testimonial highlight: "[quote from beta user] — [user first name + role]. Launching May 26."

### A.5 Launch day post (Tue May 26 morning)

```
Today, after 4 months of solo building, Tailry is live.

We're on Product Hunt right now:
[PH link]

If you've been waiting — your Founding Rate code is in
your inbox. The 100-slot cap is real. First-come basis.

If you're reading this today, here's the 60-second pitch:

→ Upload your resume once
→ Paste any job description
→ Get a tailored, ATS-safe PDF in under a minute
→ Cover letter from the same context, free
→ Every application tracked in one pipeline

Pricing: Free tier (3 tailorings/month, no credit card)
or $12/mo Pro (30/month + batch + cover letters). First
100 from the waitlist lock Pro at $7.20/mo for life.

Upvotes welcome. Brutal feedback more welcome.

tairly.com
[PH link]
```

---

## Appendix B — LinkedIn long-form article topics (rotate 1/week)

1. **"The 45-minute resume problem — why I built Tailry"** (founder story, best for Phase 1)
2. **"Why the first 100 signups on Tailry get Pro for $7.20/mo for life"** (business-model / scarcity, Phase 3)
3. **"I built Tailry solo in 4 months — here's the entire stack"** (indie-hacker flavor, Phase 3)
4. **"5 beta testers, 5 brutally honest reactions"** (social proof, Phase 4)
5. **"Why ATS parsers reject 70% of resumes — and how to fix yours"** (pure value, SEO-adjacent, any phase)
6. **"Tailry launch recap — what worked, what didn't"** (post-launch, Phase 7)

Each post: 400–800 words, 1 specific anecdote, 1 takeaway, link to `tairly.com` at the end only.

---

## Appendix C — Brevo email templates

### C.1 Stranger-beta invite (sent May 12)

```
Subject: You're invited to try Tailry before launch — free for 30 days

Hi [first name],

You signed up early on the Tailry waitlist — thank you.

We're launching May 26, but I'm inviting 10 of the earliest
signups to try the product now, free for 30 days with full
Pro access (no credit card). In return, I'd love 10 minutes
of your honest feedback on what works and what doesn't.

If you're interested, just reply "yes" and I'll send your
access link within an hour.

No pressure — and no awkwardness if now isn't the right
time.

— Fahad
Founder, Tailry
```

### C.2 Nurture email 1 — "Behind the scenes" (sent Wed May 13)

```
Subject: Tailry update — behind the scenes, 14 days out

Hi,

Quick update from the Tailry build. We're 14 days out
from launch and [N] people are on the waitlist.

Some things in the last two weeks:
• [Feature X] now ships with batch tailoring up to 3 jobs
• Beta testers are calling out the diff view as a favorite
• We're holding steady on <30s for a tailored PDF

Speaking of beta — we just added 4 testimonials to the
landing page from real people who used Tailry in beta.
Have a look if you're curious: tairly.com

There are still [100-X] Founding Rate slots left. If you
haven't shared your unique link yet, it's on your thanks
page: tairly.com/thanks?code=[CODE]

Thanks for being early.

— Fahad
Founder, Tailry
```

### C.3 Nurture email 2 — "Launch week" (sent Sat May 23)

```
Subject: Tailry launches Tuesday — your code is coming

Hi,

We launch Tuesday morning at 9 AM your local time.

Here's what to expect:
• An email from me with your personal launch link
• If you're in the first 100: your Founding Rate code
  (locks $7.20/mo Pro for life)
• If you're in slots 101+: a clean invite to Tailry at
  standard pricing, free tier included

[N] of 100 Founding slots are already claimed — so if you
want one, you have until the email arrives Tuesday to lock
yours in.

One ask: if you've been enjoying the waitlist updates,
share your unique link with one job-hunting friend.
Everyone who confirms bumps a bonus on your account
(details Tuesday).

Your link: tairly.com/thanks?code=[CODE]

See you Tuesday.

— Fahad
```

### C.4 Testimonial ask (sent to positive beta responders)

```
Subject: Would you be OK with me quoting that?

Hi [first name],

You said [PASTE THEIR EXACT WORDS from Q1] — that's
exactly the kind of feedback that helps me understand
what's working.

Quick ask: would you be OK with me using that quote on
the landing page, with your first name, last initial,
and role (e.g. "Sarah K., Product Designer")? I'd link
your LinkedIn if you're comfortable, or keep it anonymous
if not.

Totally fine to say no — I just wanted to ask before
using anything publicly.

— Fahad
```

### C.5 Launch day email (Tue May 26, 9 AM user-local)

**For Founding (first 100):**
```
Subject: Your Tailry launch code — Founding Rate locked

Hi,

Tailry is live. Your Founding Rate code is below —
use it on the Pro Monthly checkout to lock $7.20/mo
for life.

Code: [CODE]
Redeem at: tairly.com/pricing

[Button: Start Pro at $7.20/mo]

This rate persists across cancel/resume cycles. Cancel
when you land the job — resume at $7.20/mo for your
next search. Forever.

Thank you for being one of the first 100.

— Fahad
Founder, Tailry

P.S. We're also on Product Hunt today. An upvote would
help hugely, if you're on:
[PH link]
```

**For slots 101+ (standard):**
```
Subject: Tailry is live — your invite is here

Hi,

Tailry is live. Welcome aboard.

The first 100 Founding slots are gone, but you're on the
launch list and can start at standard Pro pricing ($12/mo)
or stay on the free tier (3 tailorings/month, no credit
card).

Start: tairly.com

[Button: Create your account]

Thanks for being early.

— Fahad
```

---

## Appendix D — Reddit post drafts

### D.1 Post 1 (Mon May 11)

**Subreddit:** r/jobs or r/cscareerquestions
**Title:** "I spent a year rewriting my resume for every job. Here's what I learned about what actually gets past ATS filters."

**Body (sample; rewrite in your voice):**
```
Background — I've been applying to SWE roles off and on
for about a year, and I hit the rewrite-the-resume-for-
every-JD wall hard. Here's what I actually learned about
what moves the needle:

1. Keyword matching at the skills-section level is not
subtle. If the JD says "Postgres" and you have "PostgreSQL",
align exactly. ATS parsers don't normalize.

2. Single-column plain-text is non-negotiable. Every
cute multi-column or icon-heavy template I used got
parsed wrong in about 40% of ATS systems I tested.

3. Your first bullet under each role is 10x weighted by
recruiters (not ATS, but humans). Rewrite those three
lines for every role before anything else.

4. [...3–4 more concrete, specific tips...]

After about 30 iterations I eventually built a tool to
do this in 60 seconds (tairly.com if curious). But even
without a tool, following the above consistently doubled
my callback rate.

Happy to answer questions.
```

**Rules:**
- Post **Monday 9–10 AM ET** (peak r/jobs traffic)
- Reply to every top-level comment for first 4 hours
- If it gets removed, don't repost same sub — move to a different sub with adjusted framing next week

### D.2 Post 2 (Tue May 19)

**Subreddit:** r/resumes (intent-high) or r/recruitinghell (engagement-high, different angle)
**Title:** "After 6 months of job hunting, here's the single thing that changed my callback rate"

**Body:** similar structure — one specific insight, data, casual tool mention at end.

---

## Appendix E — Launch-day runbook (Tue May 26)

### E.1 First Maker Comment (post within 5 min of PH going live)

```
Hey everyone — Fahad here, solo founder of Tailry.

Quick backstory: I watched too many friends spend 45
minutes rewriting their resume for every application,
or give up and send the same version to 50 jobs. Tailry
is the tool I wish existed.

What it does:
→ Upload your resume once, answer a short profile Q&A
→ Paste any job description
→ Get a tailored, ATS-safe PDF in under 60 seconds
→ Cover letter generated from the same context
→ Every application tracked in one pipeline
→ See a word-level diff of what the AI changed vs your
  base resume (unique to Tailry)

Pricing:
• Free — 3 tailorings/month, no credit card
• Pro — $12/mo, 30 tailorings + batch + cover letters

First 100 waitlist signups lock Pro at $7.20/mo for
LIFE. Real cap, first-come basis. About 30 slots left
as of this morning.

I'll be in this thread all day. Ask me anything — and
if it helps, an upvote would mean a ton.

tairly.com
```

### E.2 Hour-by-hour launch day log

```
12:01 AM PST — PH live. Post Maker Comment.
12:10 AM PST — LinkedIn launch post.
12:15 AM PST — Send 20 DM drafts (all at once).
01:00 AM PST — Monitor PH rank, reply to first comments.
03:00 AM PST — Check rank. If >10, push harder via
              LinkedIn engagement groups if you're in any.
06:00 AM PST — Wake up (if local Pakistan time). Rank
              check. Respond to anything missed.
09:00 AM user-local — Brevo waitlist email fires.
12:00 PM PST — Second LinkedIn post.
03:00 PM PST — Second Maker Comment on PH (social proof
              from day's activity).
08:00 PM PST — Rank check. If in Top 5, celebrate. If
              not, keep pushing.
11:59 PM PST — Final stats logged to growth.md.
```

### E.3 Response SLAs (launch day)

| Channel | Response time |
|---------|---------------|
| Product Hunt comments | <15 min |
| LinkedIn DMs | <30 min |
| Email (hello@tairly.com) | <2 hr |
| Twitter mentions | <1 hr |
| Reddit (if surfaces) | <30 min |

Have your phone on silent but in reach. Have your laptop open. This is a 20-hour workday.

---

## Appendix F — Emergency playbooks

### F.1 If launch-day emails hit Spam

1. Pause the Brevo campaign
2. Check Brevo dashboard for immediate bounce/spam complaints
3. Fix DMARC alignment issue (usually `From:` header vs sender domain)
4. Re-test via mail-tester.com
5. Resume with smaller batch (first 50 emails, then 200, then rest)

### F.2 If PH post gets low traction (rank >15 at hour 4)

1. Don't panic. Your in-day outcome is mostly set by first-hour velocity.
2. Focus on *quality* comments over upvote-begging — engagement signal matters late-day
3. Post to LinkedIn a candid "Product Hunt launch update — here's what I'm learning" — transparency wins more than pretending it's going great
4. Accept outcome. Plan V2 soft relaunch at T+14 as "Week 2 of Tailry launch" if rank disappoints

### F.3 If critical bug surfaces launch day

1. Stop new feature work immediately
2. Triage: does it block paid checkout? → FIX NOW. Otherwise queue.
3. Transparent comms: post to LinkedIn + PH "Known issue, working on it, ETA [time]" within 15 min
4. Users respect transparency. They don't respect hidden bugs.

### F.4 If Founding slots don't fill by launch day

1. Do NOT lower the cap
2. Extend redemption window to 14 days (announce Day 3 post-launch)
3. Run one final LinkedIn push Day 5 post-launch: "Last few Founding slots — window closes [date]"
4. If still not filled by Day 14, close silently. Don't announce a partial cap — honest scarcity doesn't require a footnote.

---

## Appendix G — Post-launch learning log template

Maintain in `growth.md` weekly starting Jun 3:

```
## Week N post-launch

### Numbers
- Cumulative Pro subs: N (+X this week)
- Cumulative tailorings generated: N
- Churn: X% (Y users cancelled)
- NPS: N (from M responses)

### What worked
- [specific lever]

### What didn't
- [honest assessment]

### Next week focus
- [single priority]
```

Decide the next growth lever (SEO push / paid ads / partnerships / feature expansion) at Jun 22 retrospective based on 3 weeks of post-launch data, not earlier.

---

## Related documents

- [11-waitlist-and-referral.md](./11-waitlist-and-referral.md) — Backend waitlist + referral spec (implementation reference)
- [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md) — Founding Rate business + backend behavior
- [07-subscriptions-billing.md](./07-subscriptions-billing.md) — Pro checkout + webhook handling
- [business-context.md](./business-context.md) — Personas, journeys, priorities
- `ats-fit-coming-soon-landing/docs/landing-improvements-plan.md` — Frontend F1/F2/F3 implementation sequencing
