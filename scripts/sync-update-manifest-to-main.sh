#!/usr/bin/env bash
set -euo pipefail

MANIFEST="${1:-}"
TARGET="apps/mobile-tv/public/updates/latest.json"

if [ -z "$MANIFEST" ] || [ ! -s "$MANIFEST" ]; then
  echo "Usage: $0 <update-manifest.json>" >&2
  exit 2
fi

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

tmp_current="$(mktemp)"
tmp_response="$(mktemp)"
tmp_fallback="$(mktemp)"
trap 'rm -f "$tmp_current" "$tmp_response" "$tmp_fallback"' EXIT

node - "$MANIFEST" "$tmp_fallback" <<'NODE'
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
for (const key of ['android', 'androidTv', 'ios', 'tvos']) {
  const entry = manifest[key];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
  delete entry.downloadUrl;
  delete entry.releasePageUrl;
}
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
NODE

for attempt in 1 2 3; do
  payload="$(gh api "repos/${GITHUB_REPOSITORY}/contents/${TARGET}?ref=main")"
  file_sha="$(printf '%s' "$payload" | jq -r '.sha // empty')"
  encoded_current="$(printf '%s' "$payload" | jq -r '.content // empty' | tr -d '\n')"

  if [ -z "$file_sha" ] || [ -z "$encoded_current" ]; then
    echo "Unable to read current update manifest metadata" >&2
    exit 3
  fi

  printf '%s' "$encoded_current" | base64 --decode > "$tmp_current"
  if cmp -s "$tmp_fallback" "$tmp_current"; then
    echo "Static update manifest is already current."
    exit 0
  fi

  encoded_next="$(base64 -w 0 "$tmp_fallback")"
  if gh api     --method PUT     "repos/${GITHUB_REPOSITORY}/contents/${TARGET}"     -f message='release: sync latest native update manifest'     -f content="$encoded_next"     -f sha="$file_sha"     -f branch='main'     > "$tmp_response" 2>/dev/null; then
    next_sha="$(jq -r '.commit.sha // empty' "$tmp_response")"
    echo "Synced static update manifest to main${next_sha:+ at $next_sha}."
    exit 0
  fi

  if [ "$attempt" -lt 3 ]; then
    sleep "$attempt"
  fi
done

echo "Unable to sync update manifest after retries" >&2
exit 4
