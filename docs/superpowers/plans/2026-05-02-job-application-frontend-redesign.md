# Job Application — Frontend Wiring + Edit Sidebar Redesign

**Created:** 2026-05-02
**Status:** Ready for implementation
**Repos affected:** `ats-fit-frontend` (primary) + `ats-fit-backend` (one task)
**Predecessor:** `2026-05-01-job-application-entity-expansion.md` (backend committed on `worktree-feat+job-application-entity-expansion`)

---

## 1. Goal

Two improvements, executed as one coordinated plan:

1. **Wire up the new backend fields on the frontend** — ~30 new entity fields, 10 new enums, a new interview sub-resource, and 5 new list filters added in the predecessor plan.
2. **Redesign the edit job-application sidebar** — current drawer is template-driven, flat, and missing structure. Rebuild as a reactive-forms drawer with sectioned, conditional, and progressively-disclosed content following modern UX principles.

The list view also gets a focused refresh: drop noisy columns, surface the highest-signal fields at a glance.

## 2. Non-goals

- **No autosave.** Explicit Save button only. (Show a "Saved 3s ago / Saving… / Save failed" indicator pattern, but only after explicit Save fires.)
- **No drill-into-section navigation.** Single-screen drawer with accordions only. iOS-Settings-style sub-screens deferred to v2.
- **No tag synonym/normalization service** — freeform tags. Dedupe is client-side string equality.
- **No master-detail layout.** Drawer stays as slide-out overlay.
- **No mobile-first redesign of the list table.** Existing list responsiveness is preserved; out of scope.
- **No new unit tests** (per existing project rule). Manual verification per task.

## 3. Design decisions (frozen)

| Decision | Choice | Rationale |
|---|---|---|
| Container pattern | Slide-out drawer (current pattern), 560px width on desktop, full-screen on mobile (<768px) | Constrained width enforces single-stack form, preserves list context, cheap dismissal — matches "minimal info at a time" goal |
| Form approach | Reactive Forms with typed `FormGroup` + `FormArray` | Required for cross-field validation, FormArrays (contacts), and dirty-state tracking |
| Section pattern | Accordion sections (Angular Material `mat-expansion-panel` or hand-rolled to match design tokens) | Hides complexity until needed; default open state per section is rule-based (see §6) |
| Conditional sections | `Rejection` visible only when `status=rejected`; `Offer` visible only when `status=offer` | Eliminates noise for the 90% case |
| Save model | Explicit Save button in sticky footer, dirty-state indicator | User confirmed; no autosave |
| Keyboard | `Esc` closes (with dirty-confirm dialog if dirty), `Cmd/Ctrl+S` saves, `Tab` order respects sections | Power-user affordance |
| Tags | Chip input with autocomplete from `GET /job-applications/tags` (backend addition Task 1) | Consistency without server-side normalization |
| Status timeline | Read-only horizontal chip-trail rendered from `status_history` jsonb | Surfaces audit trail |

## 4. List view — selective columns (frozen)

| # | Column | Source field(s) | Notes |
|---|---|---|---|
| 1 | Identity | `company_name` + `job_position` (stacked) | Primary scan target |
| 2 | Status | `status` | Inline-editable pill (existing `application-status-select` extended for new statuses: wishlist, interested, offer_declined) |
| 3 | Priority | `priority` | Colored dot + tooltip; new |
| 4 | Salary range | `salary_min`, `salary_max`, `salary_currency`, `salary_period` | Compact "$120k–$140k / yr" formatting; new |
| 5 | Applied | `applied_at` | Relative time (existing) |
| 6 | Next action | `decision_deadline` if present, else `follow_up_date`, else "—" | Urgency cue; new |
| 7 | Source | `job_board_source` | Small chip; new |
| ⋯ | Actions | — | Existing kebab menu |

Fields removed from the default list (still visible in drawer): `job_url`, JD preview, contact phone, raw notes.

## 5. New list-page filters (UI surface)

Backend already accepts these query params; frontend must expose them in the existing filter strip:

- `priority` (multi-select)
- `work_mode` (segmented)
- `employment_type` (multi-select)
- `tag` (chip filter — typeahead from `GET /job-applications/tags`)
- `decision_deadline_from` / `decision_deadline_to` (date range)

## 6. Sidebar — section catalog (frozen)

```
┌─ Sticky header ─────────────────────────────────────────┐
│ ← Close                                            ⋯    │
│ Company Name • Job Position                 [status ▼]  │
│ ● Priority · Source chip · Updated 2h ago              │
└──────────────────────────────────────────────────────────┘
1. Job details          (open)         [JOB]
2. Pipeline & timing    (open)         [PIPELINE]
3. Compensation         (collapsed)    [COMP]
4. Contacts             (collapsed)    [CONTACTS]
5. Interviews (n)       (open if n>0)  [INTERVIEWS — sub-resource]
6. Notes & tags         (open)         [NOTES]
7. Rejection            (visible iff status=rejected, open)         [REJECTION]
8. Offer                (visible iff status=offer, open)            [OFFER]
9. Activity timeline    (collapsed, read-only)                      [ACTIVITY]
┌─ Sticky footer ─────────────────────────────────────────┐
│ Saved 3s ago                       [Cancel] [Save]      │
└──────────────────────────────────────────────────────────┘
```

Section field mapping (entity field name → control type):

**[JOB]** company_name (input), job_position (input), job_url (input, url), job_location (input), job_board_source (select), employment_type (select), work_mode (segmented), job_description (textarea, collapsed preview)

**[PIPELINE]** status (select — already inline-editable in header), priority (segmented), applied_at (date), applied_via (select), application_deadline (date), decision_deadline (date), follow_up_date (date), is_archived (toggle)

**[COMP]** salary_min + salary_max (paired currency inputs with cross-field rule min ≤ max), salary_currency (select), salary_period (select)

**[CONTACTS]** recruiter_name, recruiter_email (email validator), hiring_manager_name, hiring_manager_email (email validator), additional contacts FormArray of `{role, name, email, phone, notes}`

**[INTERVIEWS]** sub-resource — separate component, see §7

**[NOTES]** notes (textarea), tags (chip input with autocomplete)

**[REJECTION]** rejection_reason (textarea), rejection_stage (select), rejected_at (date)

**[OFFER]** compensation_offer FormGroup: `{base_salary, currency, period, signing_bonus, equity, benefits_summary, deadline_to_respond}`

**[ACTIVITY]** read-only timeline rendered from `status_history` jsonb array

## 7. Interviews sub-resource

Standalone component embedded in section 5. Backed by new `JobApplicationInterviewService` calling `/job-applications/:id/interviews` CRUD. Each interview card shows stage chip + format icon (📞/💻/🏢) + scheduled time + outcome badge + interviewer name. Inline "+ Add interview" expands a mini-form. Per-row edit/delete with confirm.

## 8. Constraints

- **No mid-task commits.** Single commit at end of feature, matching predecessor plan rule.
- **No new unit tests.** Verify manually per task.
- **Standalone Angular components only.** No NgModules.
- **Reuse design tokens** from `src/scss/_design-tokens.scss` — do not introduce new color/spacing values without a token.
- **Match existing API patterns**: SnackbarService for notifications, `FormBuilder` + `Validators`, parent `applications-page` re-loads on saved event.

## 9. Repo path conventions

| Slice | Repo | Working dir |
|---|---|---|
| Tags endpoint | ats-fit-backend | repo root |
| All other tasks | ats-fit-frontend | `/Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend` |

Each task header below specifies which.

---

# 10. Tasks

## Task 1 — Add `GET /job-applications/tags` endpoint (backend)

- **Repo:** ats-fit-backend
- **Agency:** `Backend Architect`
- **Path:** `src/modules/job-application/job-application.controller.ts` + `job-application.service.ts`
- **Intent:** Expose distinct user-scoped tags for chip-input autocomplete.
- **Scope:**
  - Controller: `GET /job-applications/tags` — auth-guarded, returns `{ tags: string[] }` sorted alphabetically.
  - Service: `getDistinctTagsForUser(userId: string): Promise<string[]>` — `SELECT DISTINCT unnest(tags) FROM job_applications WHERE user_id = $1 AND tags IS NOT NULL ORDER BY 1`. Use TypeORM `query()` with parameterized SQL.
  - Spec doc: append to `docs/specs/06-job-applications.md` route table (one row).
- **Verify:** Hit endpoint locally with seeded data, confirm sorted distinct strings, unauthenticated requests return 401.

## Task 2 — Mirror backend enums on frontend

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/applications/models/enums/` (new directory) — one file per enum.
- **Intent:** Mirror the 10 backend enums for typed forms and selects.
- **Scope:** Create:
  - `application-status.enum.ts` (extend existing if present — must include `wishlist`, `interested`, `offer_declined` plus prior values)
  - `application-priority.enum.ts`
  - `employment-type.enum.ts`
  - `work-mode.enum.ts`
  - `job-board-source.enum.ts`
  - `applied-via.enum.ts`
  - `pay-period.enum.ts`
  - `rejection-stage.enum.ts`
  - `interview-stage.enum.ts`
  - `interview-format.enum.ts`
  - `interview-outcome.enum.ts`
  - Plus a `model/enums/index.ts` barrel.
- **Verify:** All values match backend exactly (string-equal, snake_case where applicable). Build passes.

## Task 3 — Expand `JobApplication` model + payloads

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/apply-new-job/models/` (existing) — add fields to `JobApplication` class and update payload types.
- **Intent:** Make the FE entity model lossless against the backend response.
- **Scope:**
  - `JobApplication` class: add ~30 new fields (camelCase getters wrapping snake_case API). Cover all fields enumerated in §6 plus `status_history`, `compensation_offer`, `tags`, `is_archived`, `archived_at`, `metadata`, `created_at`, `updated_at`. Parse jsonb fields directly (no transform).
  - `JobApplicationCreatePayload` — type covering all create-DTO fields (new file or extend existing).
  - `JobApplicationUpdatePayload` — expand from current ~10 fields to full ~50 fields per backend `UpdateJobApplicationDto`. Keep snake_case keys (matches API).
  - Add typed interfaces for nested jsonb shapes: `IJobApplicationContact`, `IJobApplicationCompensationOffer`, `IJobApplicationStatusHistoryEntry`, `IJobApplicationAttachment`. Place under `models/interfaces/`.
- **Verify:** TypeScript build passes. No `any` introduced.

## Task 4 — Add `JobApplicationInterview` model + payloads

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/applications/models/interview/` (new).
- **Intent:** Type the new sub-resource.
- **Scope:**
  - `job-application-interview.model.ts` — class mirroring backend entity (id, job_application_id, stage, format, outcome, scheduled_at, completed_at, duration_minutes, interviewer_name, interviewer_email, location_or_link, notes, created_at, updated_at).
  - `job-application-interview-create-payload.model.ts` — required: stage; rest optional.
  - `job-application-interview-update-payload.model.ts` — all optional incl. stage.
- **Verify:** Build passes; types align with backend DTOs.

## Task 5 — Add `JobApplicationInterviewService`

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/applications/services/job-application-interview.service.ts` (new).
- **Intent:** CRUD against `/job-applications/:id/interviews`.
- **Scope:**
  - `@Injectable({ providedIn: 'root' })`.
  - Methods: `list(jobApplicationId)`, `create(jobApplicationId, payload)`, `update(jobApplicationId, interviewId, payload)`, `delete(jobApplicationId, interviewId)`.
  - Use existing `HttpClient` + `API_ROUTES` constants pattern. Add new entries to `api.constant.ts`.
  - Handle 404/403 surfaces via existing interceptor; component-level catchError reuses SnackbarService pattern.
- **Verify:** Manual smoke against running backend endpoints (after Task 1 of predecessor plan migrations applied locally).

## Task 6 — Extend `JobService` query types + add `getTags()`

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/apply-new-job/services/job.service.ts` + matching query type model.
- **Intent:** Surface new list filters and tags endpoint to the page.
- **Scope:**
  - Extend the typed query params object passed to `getJobs()` with: `priority`, `work_mode`, `employment_type`, `tag`, `decision_deadline_from`, `decision_deadline_to`. Pass through to `HttpParams`.
  - Add `getTags(): Observable<string[]>` calling `GET /job-applications/tags`. Include base API route in `api.constant.ts`.
- **Verify:** Build + manual call to both endpoints with `getJobs({ priority: 'high' })` and `getTags()`.

## Task 7 — Build/audit shared form primitives

- **Repo:** ats-fit-frontend
- **Agency:** `UI Designer`
- **Path:** `src/app/shared/components/ui/` (existing primitives + new ones).
- **Intent:** Ensure the redesign has the controls it needs, styled to design tokens. Audit first; build only what's missing.
- **Scope (audit, then build only what's missing):**
  - `chip-input` — multi-tag input with autocomplete callback prop. **Likely new.**
  - `currency-input` — number input with currency-prefix and step rules. **Likely new.**
  - `salary-range` — wrapper around two `currency-input`s with min ≤ max validator. **Likely new.**
  - `segmented-control` — for work_mode, priority. **Likely new.**
  - `date-input` — confirm existing wrapper covers null + range; if not, extend.
  - `accordion-section` — confirm if Material `mat-expansion-panel` is themed to tokens; if it doesn't match, build a minimal hand-rolled accordion in `shared/components/ui/accordion/`.
  - All primitives must be standalone, support reactive-forms `ControlValueAccessor` where they hold a value, and use design tokens only.
- **Verify:** Manually drop each primitive into a sandbox/route; confirm visual match to existing buttons/inputs and reactive-form binding works.

## Task 8 — Drawer shell: reactive forms migration + sticky header/footer + 560px width

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/applications/components/application-detail-drawer.component.ts` + `.scss` + matching template file.
- **Intent:** Rebuild the drawer chrome and form scaffolding. Sections come in subsequent tasks.
- **Scope:**
  - Replace template-driven `[(ngModel)]` with a typed `FormGroup`. Initial structure:
    ```ts
    form = this.fb.group({
      jobDetails: this.fb.group({…}),
      pipeline: this.fb.group({…}),
      compensation: this.fb.group({…}),
      contacts: this.fb.array<FormGroup>([]),
      notes: this.fb.control<string|null>(null),
      tags: this.fb.control<string[]>([]),
      rejection: this.fb.group({…}),
      offer: this.fb.group({…}),
    });
    ```
  - On open: fetch entity, then `form.patchValue(...)` and reset dirty state.
  - **Sticky header:** identity row (company • position) + status pill (already inline-editable, keep it bound to `pipeline.status`) + priority dot + source chip + close button.
  - **Sticky footer:** "Saved Xs ago / Saving… / Save failed" indicator (text only, no autosave logic) + Cancel + Save (disabled when pristine).
  - Width: 560px desktop, full-screen <768px (Tailwind responsive).
  - Save handler: collect dirty values, call `JobService.editJob(id, payload)`, on success — emit `saved` event (existing pattern), close drawer, snackbar success.
  - On dirty-close attempt (Esc or backdrop): show confirm dialog "Discard unsaved changes?".
  - Drop existing flat fields from the template (sections will replace them in Tasks 9–17).
  - Loading skeleton: while fetch is in-flight, render a 3-block skeleton matching section heights.
- **Verify:** Drawer opens, fetches, shows skeleton then form chrome with all sections empty. Save button is disabled until any control is dirty. Esc with dirty form prompts confirm. Width is correct on desktop and mobile.

## Task 9 — Section: Job details

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template + new partial component if it grows large (`components/sections/job-details-section.component.ts`).
- **Intent:** Build the JOB section per §6.
- **Scope:** Inputs for company_name (required), job_position (required), job_url (URL validator), job_location, job_board_source (select), employment_type (select), work_mode (segmented), job_description (textarea, character counter, default collapsed preview "Show full description"). Bound to `form.controls.jobDetails`.
- **Verify:** All controls bind; required + URL validation surface inline errors; saving updates DB.

## Task 10 — Section: Pipeline & timing

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template (or new section component if size warrants).
- **Intent:** Build PIPELINE section per §6.
- **Scope:** status (select — already in header but keep authoritative control here too, syncing both), priority (segmented), applied_at (date), applied_via (select), application_deadline (date), decision_deadline (date), follow_up_date (date), is_archived (toggle). Bound to `form.controls.pipeline`.
- **Verify:** Date pickers render; status changes from this section sync the header pill; toggling is_archived persists.

## Task 11 — Section: Compensation

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template + use `salary-range` primitive (Task 7).
- **Intent:** Build COMP section.
- **Scope:** salary-range (min/max with cross-field rule), salary_currency (select — common ISO 4217), salary_period (select). Default collapsed; auto-open if any value present on load.
- **Verify:** Cross-field validation triggers error when min > max; cleared value (both empty) is allowed and saves as null.

## Task 12 — Section: Contacts (FormArray)

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template + new `contacts-section.component.ts` (size warrants split).
- **Intent:** Build CONTACTS section with primary recruiter/HM fields plus a FormArray of additional contacts.
- **Scope:**
  - Top: `recruiter_name`, `recruiter_email` (email validator), `hiring_manager_name`, `hiring_manager_email` (email validator).
  - Below: "Additional contacts" — repeater of `{role (select), name, email (email validator), phone, notes}`. "+ Add contact" appends a row; per-row delete with confirm.
  - Empty-state message above the repeater when array is empty.
- **Verify:** Add/remove rows; email validation per row; saved payload contains the contacts array.

## Task 13 — Sub-resource section: Interviews

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** new `components/sections/interviews-section.component.ts` + child `interview-card.component.ts` + `interview-form.component.ts`.
- **Intent:** Build the embedded sub-resource UI per §7.
- **Scope:**
  - On drawer open, call `JobApplicationInterviewService.list(jobId)` and store in a signal.
  - Each interview rendered as a card: stage chip + format icon (📞 phone / 💻 video / 🏢 onsite) + scheduled date (relative + absolute on hover) + outcome badge + interviewer name. Edit and delete actions per card.
  - Inline "+ Add interview" expands an inline mini-form (stage required; format, scheduled_at, interviewer_name, interviewer_email (email validator), location_or_link, notes optional). Submit calls `create()`, refreshes list.
  - Edit reuses the same mini-form pre-filled.
  - Delete shows native confirm dialog; calls `delete()`, refreshes list.
  - Sort by `scheduled_at` desc with nulls last.
  - Loading and empty states.
- **Verify:** Full CRUD against running backend; cascade delete confirmed (delete parent app → child interviews vanish on next list load).

## Task 14 — Section: Notes & tags (with autocomplete)

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template + `chip-input` primitive from Task 7.
- **Intent:** Build NOTES section.
- **Scope:**
  - `notes` textarea (auto-grow, max 5000 chars with counter).
  - `tags` `chip-input` — preload distinct tags via `JobService.getTags()` on drawer open. Free-form entry allowed; autocomplete filters server tags as user types. Enter or comma commits a chip. Backspace on empty input deletes last chip.
- **Verify:** Tags persist on save; autocomplete shows existing user tags; freeform input creates new tags.

## Task 15 — Conditional sections: Rejection + Offer

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template.
- **Intent:** Conditionally render REJECTION and OFFER sections based on status.
- **Scope:**
  - REJECTION: visible only when `form.controls.pipeline.controls.status.value === 'rejected'`. Fields: rejection_reason (textarea), rejection_stage (select), rejected_at (date, default = today on first show).
  - OFFER: visible only when `form.controls.pipeline.controls.status.value === 'offer'`. Builds a `compensation_offer` FormGroup (subset of: base_salary, currency, period, signing_bonus, equity, benefits_summary, deadline_to_respond) — all optional; empty group saves as null.
  - Use `*ngIf` (or `@if`) — when hidden, controls are unregistered (avoid stale validation).
  - Switching status flips visibility instantly, but values are preserved across toggles within the same drawer session (use `disable()` instead of unmount if you need to retain values).
- **Verify:** Set status to rejected → REJECTION appears; switch to offer → REJECTION hides, OFFER appears; values round-trip on save.

## Task 16 — Section: Activity timeline (read-only)

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer template + small read-only `status-timeline.component.ts`.
- **Intent:** Render `status_history` jsonb as a horizontal chip-trail.
- **Scope:**
  - Component takes `entries: IJobApplicationStatusHistoryEntry[]`.
  - Renders left-to-right: each entry as a status chip + timestamp tooltip + arrow connector.
  - Plus the seed entry (created_at → initial status) is included by the backend already, so no client-side fabrication.
  - Section default = collapsed; opening it auto-scrolls to the latest entry.
- **Verify:** Status changes saved via the form append a new entry on next refresh; visual rendering is left-to-right and wraps gracefully on narrow widths.

## Task 17 — Validation rules + keyboard shortcuts + dirty UX

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** drawer component.
- **Intent:** Polish the form for production-grade UX.
- **Scope:**
  - Cross-field validators registered on the right groups: `salary_min ≤ salary_max`, `application_deadline ≤ decision_deadline` (both optional — only validate when both present).
  - URL validator on `job_url`. Email validator already on contact emails.
  - Required: `company_name`, `job_position`. Inline error text under field on blur.
  - Save button shows aggregate error count tooltip when disabled by validation ("3 errors — fix before saving").
  - Keyboard: `Esc` (with dirty-confirm), `Cmd/Ctrl+S` (saves if valid + dirty, else focuses first invalid control).
  - Dirty indicator in footer: "Unsaved changes" pill when any control is dirty; "Saved Xs ago" after successful save (computed from a saved-at signal, not autosave).
- **Verify:** Run through each validation; keyboard shortcuts work; dirty pill toggles correctly.

## Task 18 — List view: selective columns + new statuses + filter UI

- **Repo:** ats-fit-frontend
- **Agency:** `Frontend Developer`
- **Path:** `src/app/features/applications/applications-page.component.ts` + `application-status-select.component.ts` + filter strip component(s).
- **Intent:** Refresh the list per §4 and §5.
- **Scope:**
  - Replace current columns with the 7 from §4. Identity column stacks company over position (smaller secondary line).
  - Salary range cell: `formatCompactSalary(min, max, currency, period)` helper — "$120k–$140k / yr" when both present, "$120k+ / yr" with only min, "—" if neither. Place helper in `applications/lib/format-salary.ts`.
  - Next-action cell logic: prefer `decision_deadline`, else `follow_up_date`, else "—". Highlight in red when ≤ 3 days away.
  - Update `application-status-select` options to include new statuses: `wishlist`, `interested`, `offer_declined`. Provide a color/label map.
  - Filter strip: add UI surfaces for `priority` (multi-select), `work_mode` (segmented), `employment_type` (multi-select), `tag` (chip filter using `JobService.getTags()` autocomplete), `decision_deadline_from/to` (date-range picker). Wire them to the existing query signal.
- **Verify:** Each new column renders correctly across data permutations; new statuses dropdown works; each new filter alters the list payload as expected.

## Task 19 — Spec sync + design notes

- **Repo:** ats-fit-frontend (new docs file) + ats-fit-backend (append note to existing spec)
- **Agency:** `Technical Writer`
- **Path:** `ats-fit-frontend/docs/job-application-frontend.md` (new) + `ats-fit-backend/docs/specs/06-job-applications.md` (append).
- **Intent:** Document the new frontend contract surface (component layout, form shape, services, route map) so future contributors don't reverse-engineer it.
- **Scope:**
  - New frontend doc covers: section catalog (§6), drawer chrome, form shape, conditional rules, list columns, services added.
  - Backend spec gets a single new row in the route table for `GET /job-applications/tags`.
- **Verify:** Markdown lints; links resolve.

## Task 20 — Final pass: lint, build, manual end-to-end, single commit

- **Repo:** both
- **Agency:** `Senior Developer`
- **Path:** repo-wide.
- **Intent:** Per project rule (single commit at end), run quality gates and commit.
- **Scope:**
  - Frontend: `npm run lint`, `npm run build`. Zero new warnings or errors introduced.
  - Backend (Task 1 only): `npm run lint`, `npm run build`. Zero new warnings.
  - Manual end-to-end: open list → open drawer → edit each section → add interview → save → verify list reflects → switch status to rejected → verify rejection section shows → switch to offer → verify offer section. Filter strip exercises each new filter.
  - Stage all files in each repo. Commit each repo separately with conventional commit messages:
    - **backend:** `feat(job-application): add tags endpoint for autocomplete`
    - **frontend:** `feat(applications): wire expanded entity + redesign edit drawer`
- **Verify:** Working trees clean post-commit; both branches pushable; no untracked feature files left behind.

---

## 11. Review gates

Per project SDD discipline, every implementer task gets a two-stage review:

1. **Spec compliance review** (Code Reviewer agent): "Did they build what the task spec says — no more, no less?"
2. **Code quality review** (Code Reviewer agent): "Is it clean, idiomatic, following project patterns?"

Reviewers are gates; do not substitute Agency implementer roles for them.

## 12. Rollout & risks

| Risk | Mitigation |
|---|---|
| Reactive-forms migration regressions | Task 8 ships drawer chrome only; Tasks 9–17 fill sections incrementally. Each is independently verifiable. |
| New status values not handled by existing pill component | Task 18 explicitly extends `application-status-select`. Color/label map centralized. |
| Tags endpoint returns empty for new users | UI handles empty list (chip input still accepts freeform). |
| FormArray contact rows lose state on disable() | Verified pattern in Task 12; if disable() proves problematic, fall back to *ngIf with explicit value retention via component state. |
| Drawer width breaks on tablets (768–1024px) | Tailwind responsive: `w-full md:w-[560px]`. Validate at 768/1024/1280. |
| Migration not yet applied locally → API errors | Sequence: confirm backend predecessor migrations are run before starting Task 5 onward. |

## 13. Order of execution

Critical path (cannot reorder): 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
Parallelizable after 8: 9, 10, 11, 12, 13, 14, 15, 16 (independent sections).
Then: 17 (validation/polish over completed sections), 18 (list view, independent), 19 (docs), 20 (final pass).

Recommended single-threaded order (matches numbering): 1 → 20.
