# Operating Contract — ats-fit-backend

<SYSTEM-CONTRACT priority="ABOVE-DEFAULT">
ai-dev-setup operating rules for code work:
1) Phase first: use a Superpowers skill before edits.
2) Persona: implementation Task() must use Agency mapping from `.claude/agents/_index.json` (never `general-purpose`).
3) Plan schema: each task must include `path`, `intent`, `verify`, `agency`, `docs`.
4) Docs loading: use targeted search/section reads, not whole-doc reads by default.
Ignore this contract for trivial conversation turns.
</SYSTEM-CONTRACT>


Enforcement sources:
- Claude Code hooks in `.claude/hooks/`
- Agency manifest in `.claude/agents/_index.json`
- Cursor always-on rules in `.cursorrules` and `.cursor/rules/dispatch-guard.mdc`
