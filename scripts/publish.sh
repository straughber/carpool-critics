#!/usr/bin/env bash
#
# scripts/publish.sh - build, commit, push, and prove the deploy is live.
#
# GitHub Pages rebuilds from `main` on every push, so publishing IS pushing.
# This script makes that one safe, repeatable action:
#
#   ./scripts/publish.sh              # build, commit everything, push, verify
#   ./scripts/publish.sh --auto       # scheduled mode: generated files only
#   ./scripts/publish.sh --no-verify  # skip the live-deploy check
#   ./scripts/publish.sh --message "Rewrite episode card layout"
#
# --auto refuses to run when hand-edited files are dirty, so a scheduled run
# can never publish a half-finished redesign. Manual runs commit everything.
#
# Exit codes: 0 published or nothing to do · 1 build/gate failed · 2 bad usage
#             3 push failed · 4 pushed but the live site never updated

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="manual"
VERIFY=1
DRY_RUN=0
CUSTOM_MESSAGE=""
SITE_URL="https://carpoolcritics.com"
BRANCH="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --auto)      MODE="auto"; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --message)   [ $# -ge 2 ] || { echo "--message needs text" >&2; exit 2; }; CUSTOM_MESSAGE="$2"; shift 2 ;;
    --help|-h)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

info() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit "${2:-1}"; }

# --------------------------------------------------------------- single flight
LOCK="$ROOT/.git/publish.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  HOLDER="$(cat "$LOCK/pid" 2>/dev/null || echo 0)"
  if [ "$HOLDER" != "0" ] && kill -0 "$HOLDER" 2>/dev/null; then
    fail "another publish is running (pid $HOLDER)" 0
  fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# ------------------------------------------------------------ working tree rule
# index.html is a generated file now: its hero ticket, PLAY button and signal
# strip are rewritten from the catalogue on every build (HERO-* regions). Without
# it here, an unattended --auto run would refuse to publish the moment a new
# episode dropped, which is exactly when the front door must update. The rest of
# the page is still hand-authored, so a redesign of the shell should be published
# by a manual run.
GENERATED_PATHS='^(index\.html$|episodes/|assets/images/episodes/|sitemap\.xml$|robots\.txt$|feed\.xml$|data/episodes\.json$|data/movies\.json$|data/transcripts/|data/pipeline/)'
UNAPPROVED="$(git status --porcelain | cut -c4- | grep -vE "$GENERATED_PATHS" || true)"
if [ "$MODE" = "auto" ] && [ -n "$UNAPPROVED" ]; then
  printf '%s\n' "$UNAPPROVED" | sed 's/^/  /'
  fail "uncommitted hand edits above; refusing to auto-publish them. Commit them yourself, or run without --auto." 0
fi

# ---------------------------------------------------------------------- build
info "Build (scripts/build-all.sh)"
if ! ./scripts/build-all.sh; then
  fail "build failed; nothing was committed or pushed" 1
fi

# ---------------------------------------------------------------------- gates
info "Gates"
for js in scripts/*.js script.js; do
  node --check "$js" || fail "syntax error in $js" 1
done
node -e '
  const fs = require("fs");
  for (const f of ["data/episodes.json", "data/movies.json"]) {
    JSON.parse(fs.readFileSync(f, "utf8"));
  }
' || fail "invalid JSON in data/" 1

# A Short is a clip cut from an episode, never an episode. A leaked Short once
# took "Ep. 2" and a page beside the real episode, so this is a hard gate: no
# uploaded Short id and nothing under five minutes may appear in the catalogue.
node -e '
  const fs = require("fs");
  const path = require("path");
  const ids = new Set();
  const collect = node => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === "video_id" || key === "videoId") && typeof value === "string") ids.add(value);
      else collect(value);
    }
  };
  const read = file => {
    try { collect(JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
  };
  read(path.join("..", "logs", "shorts_schedule_ledger.json"));
  const episodesRoot = path.join("..", "episodes");
  try {
    for (const dir of fs.readdirSync(episodesRoot)) {
      const shorts = path.join(episodesRoot, dir, "04_Shorts");
      if (!fs.existsSync(shorts)) continue;
      for (const file of fs.readdirSync(shorts)) {
        if (file.endsWith(".json")) read(path.join(shorts, file));
      }
    }
  } catch {}
  const catalog = JSON.parse(fs.readFileSync("data/episodes.json", "utf8"));
  const leaked = catalog.filter(ep => ep.youtubeId && ids.has(ep.youtubeId));
  const shortRuntime = catalog.filter(ep => Number(ep.durationSeconds) > 0 && Number(ep.durationSeconds) < 300);
  if (leaked.length || shortRuntime.length) {
    for (const ep of leaked) console.error(`  ✗ ${ep.id} (${ep.youtubeId}) is an uploaded Short, not an episode`);
    for (const ep of shortRuntime) console.error(`  ✗ ${ep.id} (${ep.durationSeconds}s) is too short to be an episode`);
    process.exit(1);
  }
  console.log(`  no Shorts in the catalogue (${catalog.length} Eps, ${ids.size} Short id(s) known)`);
' || fail "a YouTube Short is in the episode catalogue" 1
node scripts/test-shorts-filter.js || fail "Shorts filter regressed — a Short can become an episode" 1
[ -f episodes/index.html ] || fail "episodes/index.html missing (build-episode-pages.js did not run?)" 1
[ -f sitemap.xml ] || fail "sitemap.xml missing" 1
[ -f robots.txt ] || fail "robots.txt missing" 1
[ -f feed.xml ] || fail "feed.xml missing (build-episode-pages.js did not run?)" 1

EPISODE_COUNT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("data/episodes.json","utf8")).length)')"
# Scheduled episodes are rendered but intentionally absent from the public
# catalog, so the page count must include data/pipeline/ payloads too.
EXPECTED_PAGES="$(node -e '
  const fs = require("fs");
  const slugs = new Set();
  for (const ep of JSON.parse(fs.readFileSync("data/episodes.json", "utf8"))) {
    if (ep.slug) slugs.add(ep.slug);
  }
  try {
    for (const file of fs.readdirSync("data/pipeline")) {
      if (!file.endsWith(".json")) continue;
      const payload = JSON.parse(fs.readFileSync("data/pipeline/" + file, "utf8"));
      if (payload.slug) slugs.add(payload.slug);
    }
  } catch {}
  console.log(slugs.size);
')"
PAGE_COUNT="$(find episodes -mindepth 2 -maxdepth 2 -name index.html | wc -l | tr -d ' ')"
if [ "$EXPECTED_PAGES" != "$PAGE_COUNT" ]; then
  fail "catalog + pipeline describe $EXPECTED_PAGES episodes but $PAGE_COUNT pages were generated" 1
fi
echo "  $EPISODE_COUNT live episodes / $PAGE_COUNT pages / sitemap + robots present"

# --------------------------------------------------------------------- commit
info "Commit"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  dry run — would commit and push:"
  git status --short | sed 's/^/  /'
  exit 0
fi

git add -A
if git diff --cached --quiet; then
  AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
  if [ "${AHEAD:-0}" -eq 0 ]; then
    echo "  nothing changed since the last publish"
    echo "  live site: $SITE_URL/"
    exit 0
  fi
  echo "  working tree clean, but $AHEAD commit(s) are not pushed yet"
else
  if [ -n "${CUSTOM_MESSAGE:-}" ]; then
    COMMIT_MESSAGE="$CUSTOM_MESSAGE"
  else
    COMMIT_MESSAGE="Publish $EPISODE_COUNT episodes ($PAGE_COUNT pages) — $(date '+%Y-%m-%d %H:%M')"
  fi
  git config user.email >/dev/null 2>&1 || fail "git user.email is not set: git config --global user.email 'you@example.com'" 1
  git commit -q -m "$COMMIT_MESSAGE"
  git --no-pager log --oneline -1 | sed 's/^/  /'
fi

# ----------------------------------------------------------------------- push
info "Push to origin/$BRANCH"
git fetch origin "$BRANCH" --quiet || fail "could not reach origin (network or credentials)" 3
if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
  echo "  origin is ahead; rebasing"
  git rebase "origin/$BRANCH" || fail "rebase conflict — resolve locally, then re-run" 3
fi
if ! git push origin "$BRANCH" 2>/tmp/carpool-push.err; then
  cat /tmp/carpool-push.err >&2
  if grep -qiE "could not read Username|Authentication failed|Permission denied" /tmp/carpool-push.err; then
    fail "GitHub credentials are not set up. Run: brew install gh && gh auth login" 3
  fi
  fail "push failed" 3
fi

# --------------------------------------------------------------------- verify
if [ "$VERIFY" -eq 0 ]; then
  echo "  verification skipped (--no-verify)"
  exit 0
fi

info "Verify the live deploy"
# Hash every committed HTML page plus the two shared assets those pages pull in.
# Checking a single canary was a false pass once: the page it watched had not
# changed, so it matched an old build while index.html still served the previous
# deploy. Pages publishes atomically, but the CDN caches per file, so retry until
# every file matches instead of trusting one.
CANARY_FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && CANARY_FILES+=("$f")
done <<< "$(git ls-files '*.html' 'style.css' 'script.js' | sort -u)"
[ ${#CANARY_FILES[@]} -gt 0 ] || fail "no committed files to verify against" 1

CANARY_LOCAL=()
for f in "${CANARY_FILES[@]}"; do
  CANARY_LOCAL+=("$(shasum -a 256 "$f" | awk '{print $1}')")
done

STALE=()
for attempt in $(seq 1 20); do
  STALE=()
  for i in "${!CANARY_FILES[@]}"; do
    LIVE_HASH="$(curl -fsSL --max-time 20 "$SITE_URL/${CANARY_FILES[$i]}?cb=$(date +%s)-$attempt" 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)"
    [ "$LIVE_HASH" = "${CANARY_LOCAL[$i]}" ] || STALE+=("${CANARY_FILES[$i]}")
  done
  if [ ${#STALE[@]} -eq 0 ]; then
    echo "  live build matches pushed build after ${attempt} probe(s) (${#CANARY_FILES[@]} files)"
    printf '  %s\n' "${CANARY_FILES[@]}"
    exit 0
  fi
  printf '  waiting for Pages rebuild (%d/20, stale: %s)\n' "$attempt" "${STALE[*]}"
  sleep 15
done

fail "pushed, but the live site still serves an old build after ~5 minutes (stale: ${STALE[*]}). Check https://github.com/straughber/carpool-critics/actions" 4
