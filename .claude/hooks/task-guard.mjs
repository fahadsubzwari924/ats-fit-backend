import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function allow() {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  });
}

function deny(reason) {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function denyReason() {
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const indexPath = path.join(project, '.claude', 'agents', '_index.dispatch.json');
  let mapping = 'api->Backend Architect, ui->Frontend Developer, tests->API Tester, infra->DevOps Automator';
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const byTask = parsed?.byTask || {};
    const pairs = Object.entries(byTask).map(([k, v]) => `${k}->${v}`);
    if (pairs.length > 0) mapping = pairs.join(', ');
  } catch {
    // fallback mapping stays in place
  }
  return `ai-dev-setup: subagent_type=general-purpose is forbidden for implementation work. Resolve specialist from .claude/agents/_index.json, then retry. Mapping: ${mapping}.`;
}

function isReviewerGate(input) {
  const desc = String(input?.description || '').toLowerCase();
  const prompt = String(input?.prompt || '').toLowerCase();
  return (
    desc.includes('spec-reviewer') ||
    desc.includes('code-quality-reviewer') ||
    prompt.includes('spec-reviewer-prompt.md') ||
    prompt.includes('code-quality-reviewer-prompt.md')
  );
}

let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
}

let event;
try {
  event = raw.trim() ? JSON.parse(raw) : {};
} catch {
  allow();
  process.exit(0);
}

const input = event?.tool_input ?? {};
if (isReviewerGate(input)) {
  allow();
  process.exit(0);
}

const subagentTypeRaw = input?.subagent_type;
const subagentType =
  typeof subagentTypeRaw === 'string' ? subagentTypeRaw.trim().toLowerCase() : '';

if (subagentType === '' || subagentType === 'general-purpose') {
  deny(denyReason());
  process.exit(0);
}

allow();
