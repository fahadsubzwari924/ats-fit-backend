#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"
prompt="${CLAUDE_USER_PROMPT:-}"
if [[ -z "$prompt" ]]; then
  prompt="$(PAYLOAD="$payload" node <<'NODE'
const raw = process.env.PAYLOAD || '';
let prompt = '';
try {
  const event = raw.trim() ? JSON.parse(raw) : {};
  prompt = String(event?.prompt ?? event?.userPrompt ?? event?.input ?? '');
} catch {}
process.stdout.write(prompt.replace(/\s+/g, ' ').trim());
NODE
)"
fi

if [[ -n "$prompt" ]]; then
  words="$(printf '%s\n' "$prompt" | wc -w | tr -d ' ')"
  lower="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"
  if [[ "$words" -le 8 ]] && [[ ! "$lower" =~ (/[a-z]|src/|docs/|fix|add|implement|create|refactor|build|test|deploy|review) ]]; then
    echo '{}'
    exit 0
  fi
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<contract>ai-dev-setup rules for code tasks: 1) phase first: choose a Superpowers skill before edits, 2) persona: every Task() uses subagent_type from .claude/agents/_index.json (never general-purpose), 3) plan tasks must include path,intent,verify,agency,docs. Ignore this for trivial chat.</contract>"
  }
}
JSON
