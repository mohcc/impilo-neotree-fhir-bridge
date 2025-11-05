#!/usr/bin/env bash
# Build and push Docker image to Docker Hub
# Usage:
#   ./scripts/docker-build-push.sh [TAG]
# Env:
#   DOCKERHUB_REPO (default: mohcc/impilo-neotree-fhir-bridge)
#   DOCKERHUB_USERNAME / DOCKERHUB_TOKEN (optional for docker login)
#   BUILD_ARGS (optional)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

REPO="${DOCKERHUB_REPO:-mohcc/impilo-neotree-fhir-bridge}"
TAG_INPUT="${1:-latest}"

# Optional docker login
if [[ -n "${DOCKERHUB_USERNAME:-}" && -n "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "🔐 Logging in to Docker Hub as $DOCKERHUB_USERNAME"
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin >/dev/null
else
  echo "ℹ️  Skipping docker login (env DOCKERHUB_USERNAME / DOCKERHUB_TOKEN not set)"
fi

# Build image (multi-tag)
"$SCRIPT_DIR/docker-build.sh" "$TAG_INPUT"

# Determine tags to push
PKG_VERSION=$(node -pe "require('./package.json').version" 2>/dev/null || echo "0.0.0")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")

# Push tags
set -x
docker push "$REPO:$TAG_INPUT"
docker push "$REPO:$PKG_VERSION"
docker push "$REPO:$GIT_SHA"
set +x

echo "✅ Pushed:"
echo "  - $REPO:$TAG_INPUT"
echo "  - $REPO:$PKG_VERSION"
echo "  - $REPO:$GIT_SHA"
