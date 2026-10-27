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
SITE_URL="https://straughber.github.io/carpool-critics"
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
GENERATED_PATHS='^(episodes/|sitemap\.xml$|robots\.txt$|data/episodes\.json$|data/movies\.json$|data/transcripts/)'
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
[ -f episodes/index.html ] || fail "episodes/index.html missing (build-episode-pages.js did not run?)" 1
[ -f sitemap.xml ] || fail "sitemap.xml missing" 1
[ -f robots.txt ] || fail "robots.txt missing" 1

EPISODE_COUNT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("data/episodes.json","utf8")).length)')"
PAGE_COUNT="$(find episodes -mindepth 2 -maxdepth 2 -name index.html | wc -l | tr -d ' ')"
if [ "$EPISODE_COUNT" != "$PAGE_COUNT" ]; then
  fail "catalog has $EPISODE_COUNT episodes but only $PAGE_COUNT pages were generated" 1
fi
echo "  $EPISODE_COUNT episodes / $PAGE_COUNT pages / sitemap + robots present"

# --------------------------------------------------------------------- commit
info "Commit"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  dry run — would commit and push:"
  git status --short | sed 's/^/  /'
  exit 0
fi

git add -A
if git diff --cached --quiet; then
  echo "  nothing changed since the last publish"
  echo "  live site: $SITE_URL/"
  exit 0
fi

if [ -n "${CUSTOM_MESSAGE:-}" ]; then
  COMMIT_MESSAGE="$CUSTOM_MESSAGE"
else
  COMMIT_MESSAGE="Publish $EPISODE_COUNT episodes ($PAGE_COUNT pages) — $(date '+%Y-%m-%d %H:%M')"
fi
git config user.email >/dev/null 2>&1 || fail "git user.email is not set: git config --global user.email 'you@example.com'" 1
git commit -q -m "$COMMIT_MESSAGE"
git --no-pager log --oneline -1 | sed 's/^/  /'

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
LOCAL_HASH="$(shasum -a 256 episodes/index.html | awk '{print $1}')"
CANARY="$SITE_URL/episodes/index.html"
for attempt in $(seq 1 20); do
  LIVE_HASH="$(curl -fsSL --max-time 20 "$CANARY?cb=$(date +%s)-$attempt" 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)"
  if [ "$LIVE_HASH" = "$LOCAL_HASH" ]; then
    echo "  live build matches pushed build after ${attempt} probe(s)"
    echo "  $SITE_URL/episodes/index.html"
    exit 0
  fi
  printf '  waiting for Pages rebuild (%d/20)\n' "$attempt"
  sleep 15
done

fail "pushed, but the live site still serves the old build after ~5 minutes. Check https://github.com/straughber/carpool-critics/actions" 4
