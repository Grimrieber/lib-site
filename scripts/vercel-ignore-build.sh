#!/usr/bin/env bash
# Vercel "Ignored Build Step" — decides whether a commit needs a rebuild.
#
#   exit 0 -> SKIP the build      exit 1 -> BUILD
#
# WHY
#
# data/snapshot.json is committed by the refresh cron every couple of hours.
# It used to be compiled into the bundle, so each of those commits rebuilt all
# 35 functions to ship a 0.5 MB JSON file — 227 of 249 deployments in a 30-day
# window, ~162 MB of function bundle apiece. That is what exhausted the 10 GB
# Function Storage tier twice; deployment COUNT was never the lever, deployment
# CREATION was.
#
# The site now reads that file at runtime (lib/snapshot-store.ts), published by
# /api/snapshot-publish before the commit happens. So a data-only commit has
# nothing a rebuild would change, and we skip it. Anything touching code, deps
# or config still builds normally.
#
# FAILS TOWARD BUILDING. Every branch we can't reason about confidently ends in
# `exit 1`. A needless build costs storage; a wrongly skipped one ships nothing
# and silently freezes the deployment, which is far worse and much harder to
# spot.
set -uo pipefail

# Only ever skip on the production branch. Previews should always build.
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "not production (VERCEL_ENV=${VERCEL_ENV:-unset}) -> build"
  exit 1
fi

# Vercel clones shallow, so HEAD^ usually isn't there yet. Deepen by one; if we
# still can't see the parent we have no diff to judge, so build.
if ! git rev-parse --verify --quiet "HEAD^" >/dev/null 2>&1; then
  git fetch --deepen=1 >/dev/null 2>&1 || true
fi
if ! git rev-parse --verify --quiet "HEAD^" >/dev/null 2>&1; then
  echo "no parent commit available (shallow clone) -> build"
  exit 1
fi

CHANGED=$(git diff --name-only "HEAD^" HEAD 2>/dev/null) || {
  echo "could not diff against parent -> build"
  exit 1
}

if [ -z "$CHANGED" ]; then
  echo "empty diff -> build"
  exit 1
fi

# Anything outside data/ means real code shipped.
OUTSIDE=$(printf '%s\n' "$CHANGED" | grep -v '^data/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "code changed -> build:"
  printf '  %s\n' $OUTSIDE
  exit 1
fi

echo "data-only commit -> skip build (published via /api/snapshot-publish):"
printf '  %s\n' $CHANGED
exit 0
