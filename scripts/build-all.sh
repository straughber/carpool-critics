#!/usr/bin/env bash
#
# scripts/build-all.sh - one command, correct order, idempotent.
#
# The order used to be tribal knowledge: sync the catalog, fetch any missing
# caption tracks, re-sync so transcriptFile gets wired, enrich movies from
# TMDb, then render the pages. Skipping the last step silently ships a catalog
# with no episode pages, so this is the only supported way to build.
#
#   ./scripts/build-all.sh                  # normal build
#   ./scripts/build-all.sh --skip-transcripts
#   ./scripts/build-all.sh --retry-skipped  # ignore the 7-day caption cooldown
#
# Transcripts are fetched only for episodes that have no transcript file yet,
# so this is a per-new-episode cost, not a per-build cost. A failure is
# non-fatal: the site shows "Transcript coming soon" and the episode is
# retried after a cooldown.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_TRANSCRIPTS=0
RETRY_SKIPPED=0
for arg in "$@"; do
  case "$arg" in
    --skip-transcripts) SKIP_TRANSCRIPTS=1 ;;
    --retry-skipped)    RETRY_SKIPPED=1 ;;
    -h|--help)          sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
warn() { printf '  ⚠️  %s\n' "$1"; }

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }

# TMDb token: environment wins, otherwise website/.env (gitignored).
if [ -z "${TMDB_READ_TOKEN:-}" ] && [ -z "${TMDB_API_KEY:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# ---------------------------------------------------------------- 1. catalog
step "Sync episode catalog from YouTube"
node scripts/fetch-youtube.js

# ------------------------------------------------------------- 2. transcripts
if [ "$SKIP_TRANSCRIPTS" -eq 1 ]; then
  step "Captions: skipped (--skip-transcripts)"
elif ! command -v yt-dlp >/dev/null; then
  step "Captions: skipped (yt-dlp not installed)"
  warn "brew install yt-dlp to enable transcript fetching"
else
  step "Captions: fetch for episodes missing one"
  FETCHED=$(RETRY="$RETRY_SKIPPED" node -e '
    const fs = require("fs");
    const path = require("path");
    const { execFileSync } = require("child_process");
    const ROOT = process.cwd();
    const cachePath = path.join(ROOT, ".cache/transcript-failures.json");
    const DAY = 86400000;
    let failures = {};
    try { failures = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}
    const retry = process.env.RETRY === "1";
    const now = Date.now();

    let episodes = [];
    try { episodes = JSON.parse(fs.readFileSync(path.join(ROOT, "data/episodes.json"), "utf8")); }
    catch { console.log("0"); process.exit(0); }

    let fetched = 0;
    for (const ep of episodes) {
      const target = path.join(ROOT, "data/transcripts", `${ep.id}.json`);
      if (fs.existsSync(target)) continue;
      const lastFail = failures[ep.id] || 0;
      if (!retry && now - lastFail < 7 * DAY) {
        console.log(`  ↷ ${ep.id}: cooling down after an earlier failure`);
        continue;
      }
      try {
        execFileSync("node", ["scripts/fetch-transcript.js", ep.id], { stdio: "inherit" });
        delete failures[ep.id];
        fetched += 1;
      } catch {
        failures[ep.id] = now;
        console.error(`  ⚠️  ${ep.id}: no usable caption track (retry in 7 days)`);
      }
    }
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(failures, null, 2));
    console.log(String(fetched));
  ' | tail -n 1)
  if [ "${FETCHED:-0}" -gt 0 ]; then
    # Re-sync so transcriptFile is wired onto the episodes that just gained one.
    step "Re-sync catalog to wire new transcripts"
    node scripts/fetch-youtube.js >/dev/null
  fi
  echo "  transcripts fetched this run: ${FETCHED:-0}"
fi

# ------------------------------------------------------------------ 3. movies
if [ -n "${TMDB_READ_TOKEN:-}" ] || [ -n "${TMDB_API_KEY:-}" ]; then
  step "Enrich movie metadata from TMDb"
  node scripts/fetch-tmdb.js
else
  step "TMDb: skipped (no TMDB_READ_TOKEN in environment or .env)"
  warn "existing data/movies.json will be used"
fi

# ------------------------------------------------------------------- 4. pages
step "Render episode pages, archive, sitemap, robots"
node scripts/build-episode-pages.js

printf '\n\033[32m✓ build complete\033[0m  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
