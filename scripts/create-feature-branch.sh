#!/bin/bash
# Create a feature branch for development
# Usage: ./scripts/create-feature-branch.sh feature-name

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <feature-name>"
  echo ""
  echo "Example:"
  echo "  $0 add-patient-search"
  echo "  $0 fix-openhim-auth"
  exit 1
fi

FEATURE_NAME="$1"
BRANCH_NAME="feature/$FEATURE_NAME"

cd "$(dirname "$0")/.."

echo "🌿 Creating feature branch: $BRANCH_NAME"
echo ""

# Check if on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "⚠️  Warning: You're not on main branch (current: $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "⚠️  You have uncommitted changes!"
  echo "Please commit or stash them before creating a feature branch."
  exit 1
fi

# Create and checkout feature branch
git checkout -b "$BRANCH_NAME"
echo ""
echo "✅ Created and switched to: $BRANCH_NAME"
echo ""
echo "Next steps:"
echo "1. Make your changes"
echo "2. Commit: git add . && git commit -m 'Your message'"
echo "3. Push: git push -u origin $BRANCH_NAME"
echo "4. Create Pull Request: gh pr create --base main --head $BRANCH_NAME"

