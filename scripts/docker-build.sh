#!/usr/bin/env bash
# Build Docker image for Impilo-Neotree FHIR Bridge
# Usage:
#   ./scripts/docker-build.sh [TAG]
# Env:
#   DOCKERHUB_REPO (default: mohcc/impilo-neotree-fhir-bridge)
#   BUILD_ARGS (optional)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

REPO="${DOCKERHUB_REPO:-mohcc/impilo-neotree-fhir-bridge}"
# infer version from package.json if available
PKG_VERSION=$(node -pe "require('./package.json').version" 2>/dev/null || echo "0.0.0")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
TAG_INPUT="${1:-latest}"

# resolve final tags
TAG_MAIN="$TAG_INPUT"
TAG_VERSION="$PKG_VERSION"
TAG_SHA="$GIT_SHA"

echo "🔨 Building Docker image..."

echo "Repository : $REPO"
echo "Tags       : $TAG_MAIN, $TAG_VERSION, $TAG_SHA"

# build once and tag multiple
DOCKER_BUILDKIT=1 docker build \
  ${BUILD_ARGS:-} \
  -t "$REPO:$TAG_MAIN" \
  -t "$REPO:$TAG_VERSION" \
  -t "$REPO:$TAG_SHA" \
  .

echo "✅ Build complete:"
echo "  - $REPO:$TAG_MAIN"
echo "  - $REPO:$TAG_VERSION"
echo "  - $REPO:$TAG_SHA"
