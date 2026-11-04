#!/bin/bash
# Vercel's Ignored Build Step: exit 0 skips the build, exit 1 builds. Skips only when every change since the last
# successful deployment is outside the site. Anything uncertain builds, so a site change can't be skipped by mistake.

prev="$VERCEL_GIT_PREVIOUS_SHA"

# First deployment of a branch, or a CLI deploy with no git history.
[ -n "$prev" ] || exit 1
# The previous commit isn't in Vercel's shallow clone.
git cat-file -e "$prev^{commit}" 2>/dev/null || exit 1
# Same commit again: a redeploy, for example after changing an env var.
[ "$(git rev-parse "$prev")" != "$(git rev-parse HEAD)" ] || exit 1

if git diff --quiet "$prev" HEAD -- . ':(exclude)mcp' ':(exclude)brand' ':(exclude)official-apis' ':(exclude)examples' ':(exclude)contracts' ':(exclude)README.md'; then
  echo "No site files changed since $prev: skipping the build."
  exit 0
fi
exit 1
