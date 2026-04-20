#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

TEST_TARGETS=(
  db_integration
  correlate_integration
  rest_integration
  pty_integration
  ws_integration
  ingester_integration
)

DOCKER_CONTAINER_NAME=""

cleanup() {
  if [[ -n "${DOCKER_CONTAINER_NAME}" ]]; then
    docker rm -f "${DOCKER_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker exec "${DOCKER_CONTAINER_NAME}" pg_isready -U postgres -d shuttlecraft >/dev/null 2>&1 \
      && docker exec "${DOCKER_CONTAINER_NAME}" psql -U postgres -d shuttlecraft -c 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "shuttlecraft: postgres test container did not become ready" >&2
  return 1
}

ensure_test_db() {
  if [[ -n "${SHUTTLECRAFT_TEST_DB:-}" ]]; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "shuttlecraft: set SHUTTLECRAFT_TEST_DB or install Docker to run backend integration tests" >&2
    return 1
  fi

  DOCKER_CONTAINER_NAME="shuttlecraft-test-db-${PPID}-$$"
  trap cleanup EXIT

  docker run \
    --rm \
    -d \
    --name "${DOCKER_CONTAINER_NAME}" \
    -p "127.0.0.1::5432" \
    -e POSTGRES_PASSWORD=testpass \
    -e POSTGRES_DB=shuttlecraft \
    postgres:16 >/dev/null

  wait_for_postgres

  local mapped_port
  mapped_port="$(docker port "${DOCKER_CONTAINER_NAME}" 5432/tcp | awk -F: 'END { print $NF }')"
  if [[ -z "${mapped_port}" ]]; then
    echo "shuttlecraft: failed to discover mapped postgres port" >&2
    return 1
  fi

  export SHUTTLECRAFT_TEST_DB="postgres://postgres:testpass@127.0.0.1:${mapped_port}/shuttlecraft"
}

run_target() {
  local target="$1"
  echo "==> cargo test --release --test ${target} -- --ignored --test-threads=1"
  (
    cd "${BACKEND_DIR}"
    cargo test --release --test "${target}" -- --ignored --test-threads=1
  )
}

ensure_test_db

for target in "${TEST_TARGETS[@]}"; do
  run_target "${target}"
done
