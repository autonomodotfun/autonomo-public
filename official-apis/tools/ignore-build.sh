#!/bin/bash
# Vercel's Ignored Build Step for the tools API: exit 0 skips the build, exit 1 builds.
#
# This project used to rebuild on every push to the repo, though most pushes change only the site. It now builds only
# when something it is built from changed: this folder (its README and tests aside), or the repo's .vercelignore,
# which decides what of this folder reaches the build. Anything uncertain builds, so a change here can't be skipped
# by mistake. A skipped build leaves the deployment that is live in place.

cd "$(dirname "$0")" || exit 1

# Exit 0 only when nothing this project is built from differs between the given commit and this one.
unchanged_since() {
  git diff --quiet "$1" HEAD -- . ../../.vercelignore ':(exclude)README.md' ':(exclude)test'
}

skip() {
  echo "Nothing the tools API is built from changed since $1: skipping the build."
  exit 0
}

prev="$VERCEL_GIT_PREVIOUS_SHA"

if [ -n "$prev" ]; then
  # Same commit again: a redeploy, for example after changing an env var.
  [ "$prev" != "$(git rev-parse HEAD)" ] || exit 1
  # Vercel's clone is shallow. After several skipped builds in a row the last deployed commit can be missing from
  # it, so it is fetched; if that doesn't work, build.
  git cat-file -e "$prev^{commit}" 2>/dev/null || git fetch --quiet --depth=1 origin "$prev" 2>/dev/null
  git cat-file -e "$prev^{commit}" 2>/dev/null || exit 1
  unchanged_since "$prev" && skip "$prev"
  exit 1
fi

# The first deployment of a branch has nothing to compare with. For a preview, compare with main: a branch whose
# copy of this folder is the same as main's would only build what production already runs.
[ "$VERCEL_ENV" = "preview" ] || exit 1
git fetch --quiet --depth=1 origin main 2>/dev/null || exit 1
main="$(git rev-parse --verify --quiet FETCH_HEAD)" || exit 1
unchanged_since "$main" && skip "main ($main)"
exit 1
