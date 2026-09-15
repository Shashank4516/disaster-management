#!/usr/bin/env bash
# Clean start for the EnvironetBE stack (api on :3000, db on :5432).
# Stops any previous run, kills anything squatting on the service ports,
# then builds and starts everything fresh.
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT=3000
DB_PORT=5432

port_busy() {
  ss -tlnH "sport = :$1" 2>/dev/null | grep -q .
}

free_port() {
  local port=$1 pids
  for _ in 1 2 3; do
    port_busy "$port" || return 0
    pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "Port $port in use by pid(s): $(echo "$pids" | tr '\n' ' ') - killing"
      kill $pids 2>/dev/null || true
      sleep 1
      pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
        sleep 1
      fi
    else
      # Held by a process this user cannot see or kill (e.g. a system service).
      echo "Port $port held by a system process - trying: sudo -n systemctl stop postgresql"
      if sudo -n systemctl stop postgresql 2>/dev/null; then
        sleep 2
      else
        echo "ERROR: port $port is in use by a process this user cannot stop." >&2
        echo "Run manually:  sudo systemctl stop postgresql" >&2
        echo "(optionally:   sudo systemctl disable postgresql  so it does not take the port again on reboot)" >&2
        return 1
      fi
    fi
  done
  if port_busy "$port"; then
    echo "ERROR: port $port is still in use." >&2
    return 1
  fi
}

# Stop any previous run of this stack (volumes are kept).
docker compose down --remove-orphans >/dev/null 2>&1 || true

free_port "$API_PORT"
free_port "$DB_PORT"

echo "Starting stack: api on :$API_PORT, db on :$DB_PORT"
docker compose up --build -d

# Wait for the database healthcheck.
db_status=""
for _ in $(seq 1 60); do
  db_status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q db)" 2>/dev/null || true)
  [ "$db_status" = "healthy" ] && break
  sleep 2
done
if [ "$db_status" != "healthy" ]; then
  echo "ERROR: database did not become healthy - last logs:" >&2
  docker compose logs db --tail 50 >&2
  exit 1
fi

docker compose ps
echo "API:      http://localhost:$API_PORT/health"
echo "DB check: http://localhost:$API_PORT/db/health"
echo "DB:       postgresql://localhost:$DB_PORT/environet_db  (user: environet)"
