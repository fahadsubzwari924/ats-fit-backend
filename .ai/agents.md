# Agent activation — ats-fit-backend

**Agency Agents** (vendored in `vendor/agency-agents/`) are the default specialist system. **Superpowers** (vendored in `vendor/superpowers/`) is the default workflow engine. Use both together: Superpowers for phase discipline, Agency for role fit.

## Layout

| Piece | Claude Code | Cursor |
|-------|-------------|--------|
| Agency | `.claude/agents/*.md` | `.cursor/rules/agency-*.mdc` |
| Superpowers skills | `.claude/skills/` | `.cursor-plugin` → `vendor/superpowers` |

## Implementation plans + Superpowers subagents

**Superpowers** skills such as `subagent-driven-development` describe *how* to delegate (fresh context, reviews). **Agency** files describe *who* does the work (backend architect, frontend developer, etc.). Both apply together.

### Claude Code: dispatch via native `subagent_type`

Claude Code auto-loads the full Agency persona when you dispatch with the matching `subagent_type`:

```
Task({
  subagent_type: "engineering-backend-architect",   // NOT "general-purpose"
  description: "Implement Task N: <short name>",
  prompt: "<task spec + context, exactly as Superpowers' implementer-prompt.md defines>"
})
```

The runtime opens `.claude/agents/engineering-backend-architect.md` and installs its full body as the subagent's system prompt — no manual Read, no inlining, no ambiguity.

**Substitution rule for Superpowers:** when `subagent-driven-development`'s `implementer-prompt.md` shows `Task tool (general-purpose)`, **substitute** the Agency `subagent_type` from the tables below. The Superpowers template is transport; the persona is Agency. This is mandatory, not optional.

### Cursor: attach the matching rule

| Situation | What to do |
|-----------|------------|
| Plan names an Agency role | Reference the rule with `@agency-backend-architect.mdc` (or equivalent — see Cursor column in tables below) in the Cursor chat before asking it to implement. |
| Plan is silent on roles | Map each task using the tables below. Prefer listing concrete agent filenames in the plan when ambiguous. |
| User says "sub-agent" / "Task" execution | Treat that as Superpowers **transport** only; **persona** still comes from Agency as above. |

> **Naming warning (Claude Code ≠ Cursor):** Claude Code uses the upstream filename with division prefix (`engineering-backend-architect`). Cursor uses the slugified frontmatter `name:` field (`backend-architect`). They are NOT interchangeable — use the column that matches your platform.

**Anti-pattern:** Dispatching implementation subagents with `subagent_type: "general-purpose"` when this repo vendors Agency. The Agency file (200+ lines of constraints, anti-patterns, deliverable templates) is the point — skipping it produces generic output.

## Engineering agents

> Claude Code uses the **upstream filename** (division-prefixed). Cursor uses the **frontmatter name slug** (no prefix). See warning above. If unsure, open `.claude/agents/_index.json` for the authoritative Claude Code map.

| Task focus | Claude Code `subagent_type` | Cursor rule | Role |
|------------|-----------------------------|-------------|------|
| API / backend / server logic | `engineering-backend-architect` | `@agency-backend-architect.mdc` | Architecture + implementation, database design, APIs |
| UI / frontend / components | `engineering-frontend-developer` | `@agency-frontend-developer.mdc` | Frontend implementation, styling, component structure |
| Tests / API testing | `testing-api-tester` | `@agency-api-tester.mdc` | Test writing, coverage gaps, edge cases, test fixtures |
| Performance / benchmarking | `testing-performance-benchmarker` | `@agency-performance-benchmarker.mdc` | Profiling, hot paths, allocations, I/O, caching |
| Infra / CI / scripts | `engineering-devops-automator` | `@agency-devops-automator.mdc` | Infrastructure, pipelines, scripts, developer ergonomics |
| Product / requirements | `product-manager` | `@agency-product-manager.mdc` | Scope, acceptance criteria, risks, user story mapping |
| System architecture | `engineering-software-architect` | `@agency-software-architect.mdc` | Boundaries, modules, data flow, system design |
| Senior generalist dev | `engineering-senior-developer` | `@agency-senior-developer.mdc` | Cross-cutting implementation, refactors, integration work |

## Quality agents

| Task focus | Claude Code `subagent_type` | Cursor rule | Role |
|------------|-----------------------------|-------------|------|
| Code review | `engineering-code-reviewer` | `@agency-code-reviewer.mdc` | Correctness, safety, maintainability, style |
| Security review | `engineering-security-engineer` | `@agency-security-engineer.mdc` | Threats, authz, input validation, secrets, supply chain |
| Documentation | `engineering-technical-writer` | `@agency-technical-writer.mdc` | Clarity, examples, diagrams, API documentation |

## Quality expectations per specialist

When operating as any implementation specialist, these rules apply **regardless of role**:

| Concern | Required behavior |
|---------|------------------|
| Magic values | Extract all strings, numbers, URLs to named constants or config before finishing a task |
| Layer discipline | Write code in the correct layer — no business logic in handlers, no DB calls outside repositories; see `docs/CONVENTIONS.md` |
| Input validation | Every public method and every route entry point validates its inputs; reject and report early |
| Engineering principles | Apply SOLID, DRY, KISS, YAGNI per `.ai/rules.md`; do not over-engineer and do not under-structure |
| Self-review | Before declaring a task done, check: are there any hardcoded values? Any unvalidated inputs? Any logic that belongs in a different layer? |

## Claude Code

**Superpowers + Agency are on by default** once `vendor/` is present—the assistant should use them without requiring the user to paste `vendor/` or `.claude/` paths each time.

- Invoke slash commands from `.claude/commands/` when they match the phase (`/kickoff`, `/implement`, `/review`, `/ship`)
- Load Agency agent definitions from `.claude/agents/`; match filename/topic to task—**including** when Superpowers dispatches implementation subagents (see § Implementation plans + Superpowers subagents)
- Keep long guidance in `docs/`; keep messages short with pointers

## Cursor

**Superpowers + Agency are on by default** via workspace rules and the Superpowers plugin—no need to ask the user to cite `.cursor-plugin` or `vendor/` paths unless setup is broken.

- Follow **`routing.mdc`** (always applied) plus `.cursor/rules/workflow.mdc`, `review.mdc`, `agents.mdc` when the task matches
- Load relevant `agency-*.mdc` when using a named Agency specialist—**including** each implementation Task/subagent during plan execution (see § Implementation plans + Superpowers subagents)
- Keep `.cursorrules` as the index; do not duplicate `.ai/rules.md`
