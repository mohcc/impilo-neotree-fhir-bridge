#!/usr/bin/env bash
#
# Dockerize Script for Impilo-Neotree FHIR Bridge
# 
# Automates Docker build, run, push, and management operations.
#
# Usage:
#   ./scripts/dockerize.sh <command> [options]
#
# Commands:
#   build       - Build Docker image locally
#   push        - Build and push to Docker Hub
#   run         - Run container locally
#   stop        - Stop running container
#   restart     - Restart container
#   logs        - View container logs
#   shell       - Open shell in container
#   status      - Show container status
#   clean       - Remove container and images
#   setup       - Create .env from env.example
#   all         - Build, stop old, run new (full deployment)
#
# Options:
#   -t, --tag TAG       Docker image tag (default: latest)
#   -d, --detach        Run in detached mode
#   -f, --follow        Follow logs
#   --no-cache          Build without cache
#   --dev               Development mode (mount source code)
#
# Environment Variables:
#   DOCKERHUB_REPO      Docker Hub repository (default: mohcc/impilo-neotree-fhir-bridge)
#   DOCKERHUB_USERNAME  Docker Hub username (for push)
#   DOCKERHUB_TOKEN     Docker Hub token (for push)
#
# Examples:
#   ./scripts/dockerize.sh build
#   ./scripts/dockerize.sh run -d
#   ./scripts/dockerize.sh push -t v1.0.0
#   ./scripts/dockerize.sh all -d
#   ./scripts/dockerize.sh logs -f
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directories
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Configuration
REPO="${DOCKERHUB_REPO:-mohcc/impilo-neotree-fhir-bridge}"
CONTAINER_NAME="neotree-bridge"
DEFAULT_PORT="${PORT:-3001}"

# Get version info
get_version() {
  node -pe "require('./package.json').version" 2>/dev/null || echo "0.0.0"
}

get_git_sha() {
  git rev-parse --short HEAD 2>/dev/null || echo "dev"
}

# Logging functions
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# Check if Docker is available
check_docker() {
  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
  fi
  
  if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running"
    exit 1
  fi
}

# Check if container is running
is_container_running() {
  docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Check if container exists (running or stopped)
container_exists() {
  docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Build Docker image
cmd_build() {
  local tag="${TAG:-latest}"
  local no_cache="${NO_CACHE:-false}"
  local version=$(get_version)
  local git_sha=$(get_git_sha)
  
  log_info "Building Docker image..."
  echo "  Repository : $REPO"
  echo "  Tags       : $tag, $version, $git_sha"
  
  local cache_flag=""
  if [[ "$no_cache" == "true" ]]; then
    cache_flag="--no-cache"
    log_info "Building without cache"
  fi
  
  DOCKER_BUILDKIT=1 docker build \
    $cache_flag \
    -t "$REPO:$tag" \
    -t "$REPO:$version" \
    -t "$REPO:$git_sha" \
    .
  
  log_success "Build complete!"
  echo "  - $REPO:$tag"
  echo "  - $REPO:$version"
  echo "  - $REPO:$git_sha"
}

# Push Docker image
cmd_push() {
  local tag="${TAG:-latest}"
  local version=$(get_version)
  local git_sha=$(get_git_sha)
  
  # Login if credentials provided
  if [[ -n "${DOCKERHUB_USERNAME:-}" && -n "${DOCKERHUB_TOKEN:-}" ]]; then
    log_info "Logging in to Docker Hub as $DOCKERHUB_USERNAME"
    echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin >/dev/null
  else
    log_warning "Docker Hub credentials not set. Using existing login."
  fi
  
  # Build first
  cmd_build
  
  # Push tags
  log_info "Pushing images to Docker Hub..."
  docker push "$REPO:$tag"
  docker push "$REPO:$version"
  docker push "$REPO:$git_sha"
  
  log_success "Pushed successfully!"
  echo "  - $REPO:$tag"
  echo "  - $REPO:$version"
  echo "  - $REPO:$git_sha"
}

# Run container
cmd_run() {
  local tag="${TAG:-latest}"
  local detach="${DETACH:-false}"
  local dev_mode="${DEV_MODE:-false}"
  
  # Check for .env file
  if [[ ! -f ".env" ]]; then
    log_warning ".env file not found. Creating from env.example..."
    cmd_setup
  fi
  
  # Stop existing container if running
  if is_container_running; then
    log_warning "Container $CONTAINER_NAME is already running. Stopping..."
    cmd_stop
  fi
  
  # Remove existing container if exists
  if container_exists; then
    log_info "Removing existing container..."
    docker rm "$CONTAINER_NAME" >/dev/null
  fi
  
  log_info "Starting container..."
  
  local run_opts=()
  run_opts+=("--name" "$CONTAINER_NAME")
  run_opts+=("--env-file" ".env")
  run_opts+=("-p" "${DEFAULT_PORT}:${DEFAULT_PORT}")
  run_opts+=("--restart" "unless-stopped")
  run_opts+=("--add-host" "host.docker.internal:host-gateway")
  
  # Health check
  run_opts+=("--health-cmd" "wget -qO- http://localhost:${DEFAULT_PORT}/health || exit 1")
  run_opts+=("--health-interval" "15s")
  run_opts+=("--health-timeout" "5s")
  run_opts+=("--health-retries" "5")
  
  # Development mode - mount source
  if [[ "$dev_mode" == "true" ]]; then
    log_info "Development mode: mounting source code"
    run_opts+=("-v" "${PROJECT_DIR}/src:/app/src:ro")
    run_opts+=("-v" "${PROJECT_DIR}/dist:/app/dist")
  fi
  
  # Detached mode
  if [[ "$detach" == "true" ]]; then
    run_opts+=("-d")
  fi
  
  docker run "${run_opts[@]}" "$REPO:$tag"
  
  if [[ "$detach" == "true" ]]; then
    log_success "Container started in background"
    echo "  Container: $CONTAINER_NAME"
    echo "  Port: $DEFAULT_PORT"
    echo ""
    echo "View logs:  ./scripts/dockerize.sh logs -f"
    echo "Stop:       ./scripts/dockerize.sh stop"
  fi
}

# Stop container
cmd_stop() {
  if is_container_running; then
    log_info "Stopping container $CONTAINER_NAME..."
    docker stop "$CONTAINER_NAME" >/dev/null
    log_success "Container stopped"
  else
    log_warning "Container $CONTAINER_NAME is not running"
  fi
}

# Restart container
cmd_restart() {
  log_info "Restarting container $CONTAINER_NAME..."
  cmd_stop
  cmd_run
}

# View logs
cmd_logs() {
  local follow="${FOLLOW:-false}"
  
  if ! container_exists; then
    log_error "Container $CONTAINER_NAME does not exist"
    exit 1
  fi
  
  local log_opts=()
  if [[ "$follow" == "true" ]]; then
    log_opts+=("-f")
  fi
  log_opts+=("--tail" "100")
  
  docker logs "${log_opts[@]}" "$CONTAINER_NAME"
}

# Open shell in container
cmd_shell() {
  if ! is_container_running; then
    log_error "Container $CONTAINER_NAME is not running"
    exit 1
  fi
  
  log_info "Opening shell in container..."
  docker exec -it "$CONTAINER_NAME" /bin/sh
}

# Show status
cmd_status() {
  echo ""
  echo "=== Neotree Bridge Status ==="
  echo ""
  
  if is_container_running; then
    log_success "Container is RUNNING"
    echo ""
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    # Health check
    local health=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
    echo "Health: $health"
    
    # Resource usage
    echo ""
    echo "Resource Usage:"
    docker stats "$CONTAINER_NAME" --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
  elif container_exists; then
    log_warning "Container exists but is STOPPED"
    docker ps -a --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  else
    log_info "Container does not exist"
  fi
  
  echo ""
  echo "=== Docker Images ==="
  docker images "$REPO" --format "table {{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"
  echo ""
}

# Clean up
cmd_clean() {
  log_warning "This will remove the container and all local images"
  read -p "Are you sure? (y/N) " -n 1 -r
  echo
  
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Stop and remove container
    if is_container_running; then
      docker stop "$CONTAINER_NAME" >/dev/null
    fi
    if container_exists; then
      docker rm "$CONTAINER_NAME" >/dev/null
      log_success "Container removed"
    fi
    
    # Remove images
    local images=$(docker images "$REPO" -q)
    if [[ -n "$images" ]]; then
      docker rmi $images --force >/dev/null 2>&1 || true
      log_success "Images removed"
    fi
    
    log_success "Cleanup complete"
  else
    log_info "Cleanup cancelled"
  fi
}

# Setup .env file
cmd_setup() {
  if [[ -f ".env" ]]; then
    log_warning ".env file already exists"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log_info "Setup cancelled"
      return
    fi
  fi
  
  if [[ -f "env.example" ]]; then
    cp env.example .env
    log_success ".env file created from env.example"
    log_warning "Please edit .env with your configuration"
    echo ""
    echo "Required configuration:"
    echo "  - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE"
    echo "  - OPENHIM_BASE_URL, OPENHIM_USERNAME, OPENHIM_PASSWORD"
    echo "  - FACILITY_ID"
    echo ""
  else
    log_error "env.example not found"
    exit 1
  fi
}

# Full deployment (build + stop + run)
cmd_all() {
  log_info "Full deployment: build → stop → run"
  echo ""
  
  cmd_build
  echo ""
  cmd_stop 2>/dev/null || true
  echo ""
  DETACH="true" cmd_run
}

# Parse arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      -t|--tag)
        TAG="$2"
        shift 2
        ;;
      -d|--detach)
        DETACH="true"
        shift
        ;;
      -f|--follow)
        FOLLOW="true"
        shift
        ;;
      --no-cache)
        NO_CACHE="true"
        shift
        ;;
      --dev)
        DEV_MODE="true"
        shift
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        break
        ;;
    esac
  done
}

# Show help
show_help() {
  head -50 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
}

# Main
main() {
  check_docker
  
  local command="${1:-help}"
  shift || true
  
  parse_args "$@"
  
  case "$command" in
    build)    cmd_build ;;
    push)     cmd_push ;;
    run)      cmd_run ;;
    stop)     cmd_stop ;;
    restart)  cmd_restart ;;
    logs)     cmd_logs ;;
    shell)    cmd_shell ;;
    status)   cmd_status ;;
    clean)    cmd_clean ;;
    setup)    cmd_setup ;;
    all)      cmd_all ;;
    help|--help|-h)
      show_help
      ;;
    *)
      log_error "Unknown command: $command"
      echo ""
      show_help
      exit 1
      ;;
  esac
}

main "$@"
