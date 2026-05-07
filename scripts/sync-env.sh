#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sync src/config/.env.prod → Railway tairly-api service variables
# Usage: npm run sync:env
#
# Run this once on first setup, then again whenever you add or change a var.
# Railway merges variables — it does not wipe existing ones.
# ---------------------------------------------------------------------------
set -euo pipefail

ENV_FILE="src/config/.env.prod"
SERVICE="tairly-api"
ENVIRONMENT="production"

echo "▶ Checking railway CLI..."
command -v railway >/dev/null 2>&1 || {
  echo "❌ railway CLI not found. Run: npm i -g @railway/cli"
  exit 1
}

echo "▶ Checking Railway login..."
railway whoami >/dev/null 2>&1 || {
  echo "❌ Not logged in. Run: railway login"
  exit 1
}

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ${ENV_FILE} not found. Create it from src/config/.env.dev before syncing."
  exit 1
fi

echo "▶ Reading ${ENV_FILE}..."

SKIPPED=0
SET_COUNT=0

while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines
  [[ -z "${line// /}" ]] && continue
  # Skip comment-only lines
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  # Must contain =
  [[ "$line" != *"="* ]] && continue

  key="${line%%=*}"
  key="${key// /}"   # strip spaces from key
  value="${line#*=}"

  # Strip wrapping single or double quotes from value
  if [[ "$value" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
    value="${BASH_REMATCH[1]}"
  else
    # Strip trailing inline comment (space + #), skip if value looks like a URL or token
    if [[ "$value" != http* ]] && [[ "$value" =~ ^([^#]+)[[:space:]]#.* ]]; then
      value="${BASH_REMATCH[1]}"
      # rtrim whitespace
      value="${value%"${value##*[![:space:]]}"}"
    fi
  fi

  [[ -z "$key" ]] && continue

  echo "   → ${key}"
  railway variables set "${key}=${value}" \
    --service "${SERVICE}" \
    --environment "${ENVIRONMENT}" 2>/dev/null \
    && SET_COUNT=$((SET_COUNT + 1)) \
    || { echo "   ⚠️  Failed to set ${key} — skipping"; SKIPPED=$((SKIPPED + 1)); }

done < "$ENV_FILE"

echo ""
echo "✅ Synced ${SET_COUNT} variable(s) to Railway ${SERVICE}."
[ "$SKIPPED" -gt 0 ] && echo "⚠️  ${SKIPPED} variable(s) failed — check the output above."
