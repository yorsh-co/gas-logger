#!/usr/bin/env bash
set -euo pipefail

# Publishes only the consumer-facing subset to the `dist` branch,
# which `git subtree add` points to in README. The dist branch tree
# is flat (no top-level dist/ folder) — the compiled module files sit
# at branch root, next to README.md, LICENSE.md, CHANGELOG.md and a
# trimmed package.json.
#
# Excluded from what ships:
#   - *.types.js   — type-only modules (interfaces/types) compile to a
#                    .js containing only 'use strict'; nothing runs, so
#                    only the matching .d.ts is useful. Hidden (sender-side
#                    only) rather than excluded, so --delete also removes
#                    copies already on the dist branch.
#
# The ambient peer declarations in peer/ live outside dist/ and are never
# built, so they are not part of the release.

VERSION=$(node --input-type=module -e "console.log((await import('./package.json', { with: { type: 'json' } })).default.version)")
TAG="dist/$VERSION"
WORKTREE_DIR=.worktrees/dist

echo "Running preflight checks..."
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean — commit or stash your changes first." >&2
  exit 1
fi
if [ -z "$(find dist -name '*.js' -print -quit 2>/dev/null)" ]; then
  echo "dist/ is missing or has no .js files — run the build first." >&2
  exit 1
fi
if git rev-parse --quiet --verify "refs/tags/$TAG" > /dev/null; then
  echo "Tag $TAG already exists locally — bump the version in package.json." >&2
  exit 1
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/$TAG")" ]; then
  echo "Tag $TAG already exists on origin — bump the version in package.json." >&2
  exit 1
fi

HAS_REMOTE_DIST=false
if [ -n "$(git ls-remote --heads origin dist)" ]; then
  HAS_REMOTE_DIST=true
  git fetch --no-prune origin dist:refs/remotes/origin/dist
fi

echo "Checking out release worktree..."
if [ -d "$WORKTREE_DIR" ]; then
  : # reuse the existing worktree
elif git show-ref --verify --quiet refs/heads/dist; then
  git worktree add "$WORKTREE_DIR" dist
elif [ "$HAS_REMOTE_DIST" = true ]; then
  echo "Local dist branch doesn't exist — creating it from origin/dist..."
  git worktree add --track -b dist "$WORKTREE_DIR" origin/dist
else
  echo "dist branch doesn't exist yet — creating orphan branch..."
  git worktree add --detach "$WORKTREE_DIR"
  git -C "$WORKTREE_DIR" checkout --orphan dist
  git -C "$WORKTREE_DIR" rm -rf . > /dev/null 2>&1 || true
fi

if [ "$HAS_REMOTE_DIST" = true ]; then
  # Never discard local release commits that origin doesn't have
  if ! git -C "$WORKTREE_DIR" merge-base --is-ancestor HEAD origin/dist; then
    echo "Local dist has commits that are not on origin/dist — resolve before releasing." >&2
    exit 1
  fi
  git -C "$WORKTREE_DIR" merge --ff-only origin/dist
fi

echo "Syncing release contents..."
rsync -a --delete \
  --exclude '.git' \
  --filter 'H *.types.js' \
  --exclude 'README.md' \
  --exclude 'LICENSE.md' \
  --exclude 'CHANGELOG.md' \
  --exclude 'package.json' \
  "dist/" "$WORKTREE_DIR/"
cp README.md LICENSE.md CHANGELOG.md "$WORKTREE_DIR/"
node scripts/write-release-package-json.js > "$WORKTREE_DIR/package.json"

echo "Committing and tagging..."
cd "$WORKTREE_DIR"
git add -A
if git diff --cached --quiet; then
  echo "Nothing to release — dist already matches the build." >&2
  exit 1
fi
git commit -m "merge: $VERSION"
git tag "$TAG"
git push origin dist "refs/tags/$TAG"
