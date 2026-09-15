#!/usr/bin/env bash
# Package the project as release images: the API plus a database image with the
# current environet_db state baked in (schema, TimescaleDB policies, and data).
#
# Usage:
#   VERSION=2026-09-08 ./scripts/package-release.sh            # build locally
#   REGISTRY=docker.io/myuser VERSION=v1 ./scripts/package-release.sh --push
#
# Requires the dev stack to be running (it is the snapshot source): npm run stack:up
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY=${REGISTRY:-}
VERSION=${VERSION:-$(date +%Y%m%d-%H%M)}
PUSH=false
[ "${1:-}" = "--push" ] && PUSH=true

API_IMAGE=${REGISTRY:+$REGISTRY/}environet-api
DB_IMAGE=${REGISTRY:+$REGISTRY/}environet-db

# 1. Snapshot source must be healthy
if ! docker compose ps db 2>/dev/null | grep -q healthy; then
  echo "ERROR: the dev database is not running/healthy - run 'npm run stack:up' first." >&2
  exit 1
fi

# 2. Capture the current database state
mkdir -p db/snapshot
docker compose exec -T db pg_dump -U environet environet_db > db/snapshot/environet_db.sql
echo "Snapshot written: db/snapshot/environet_db.sql ($(wc -c < db/snapshot/environet_db.sql) bytes)"

# 3. Build release images
echo "Building $API_IMAGE:$VERSION ..."
docker build -q -f Dockerfile -t "$API_IMAGE:$VERSION" .
echo "Building $DB_IMAGE:$VERSION (database state baked) ..."
docker build -q -f Dockerfile.db-seeded -t "$DB_IMAGE:$VERSION" .
docker tag "$API_IMAGE:$VERSION" "$API_IMAGE:latest"
docker tag "$DB_IMAGE:$VERSION" "$DB_IMAGE:latest"

echo "Built:"
echo "  $API_IMAGE:$VERSION"
echo "  $DB_IMAGE:$VERSION"

# 4. Push
if $PUSH; then
  if [ -z "$REGISTRY" ]; then
    echo "ERROR: set REGISTRY=<registry>/<owner> to push." >&2
    exit 1
  fi
  docker push "$API_IMAGE:$VERSION" && docker push "$API_IMAGE:latest"
  docker push "$DB_IMAGE:$VERSION" && docker push "$DB_IMAGE:latest"
  echo "Pushed both images to $REGISTRY"
else
  echo "Local build only - re-run with --push (and REGISTRY=...) to publish."
fi
