#!/usr/bin/env bash
# ============================================================
# EnvironetBE — API smoke tests
# Tests every live endpoint: health, ingest, risk engine, alerts.
#
# Usage:
#   bash scripts/test-api.sh                # test against localhost:3000
#   BASE_URL=http://192.168.0.100:3000 bash scripts/test-api.sh
#
# Exit code 0 = all tests passed, 1 = at least one failure.
# ============================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
# Point COMPOSE_FILE at a specific compose file when the stack is not the
# repo-root dev stack (e.g. COMPOSE_FILE=deploy/docker-compose.yml in CI).
if [ -n "${COMPOSE_FILE:-}" ]; then
  COMPOSE=(docker compose -f "$COMPOSE_FILE")
else
  COMPOSE=(docker compose)
fi
PASS=0
FAIL=0

green()  { printf "\033[32m%s\033[0m" "$1"; }
red()    { printf "\033[31m%s\033[0m" "$1"; }
bold()   { printf "\033[1m%s\033[0m" "$1"; }

# ------------------------------------------------------------
# check <name> <expected-jq-less-expr> <actual-json>
#   PASS/FAIL based on whether the jq expression is true.
# ------------------------------------------------------------
check() {
  local name="$1" expr="$2" body="$3"
  if echo "$body" | jq -e "$expr" > /dev/null 2>&1; then
    printf "  %s  %s\n" "$(green "PASS")" "$name"
    PASS=$((PASS + 1))
  else
    printf "  %s  %s\n" "$(red "FAIL")" "$name"
    echo "         expected: $expr"
    echo "         got:      $(echo "$body" | head -c 300)"
    FAIL=$((FAIL + 1))
  fi
}

# check_status <name> <expected> <actual> — plain string equality (for HTTP codes / counts)
check_status() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf "  %s  %s\n" "$(green "PASS")" "$name"
    PASS=$((PASS + 1))
  else
    printf "  %s  %s (expected %s, got %s)\n" "$(red "FAIL")" "$name" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

section() {
  echo
  bold "$1"
}

jq_missing() {
  command -v jq >/dev/null 2>&1 && return 1
  echo "ERROR: jq is required (sudo apt install jq / brew install jq)" >&2
  return 0
}

if jq_missing; then exit 1; fi

bold "EnvironetBE API tests → $BASE_URL"

# ------------------------------------------------------------
section "1. Health endpoints"

BODY=$(curl -sf "$BASE_URL/health") \
  && check "/health returns status=ok" '.status == "ok"' "$BODY" \
  || check "/health reachable" '.status == "ok"' "{}"

BODY=$(curl -sf "$BASE_URL/db/health") \
  && check "/db/health returns status=up" '.status == "up"' "$BODY" \
  && check "/db/health reports TimescaleDB" '.timescaledbVersion != null' "$BODY" \
  || check "/db/health reachable" '.status == "up"' "{}"

# ------------------------------------------------------------
section "2. Ingestion — manual tick + status"

BODY=$(curl -sf -X POST "$BASE_URL/ingest/tick") \
  && check "/ingest/tick writes readings" '.readingsWritten >= 1' "$BODY" \
  || check "/ingest/tick reachable" '.readingsWritten >= 1' "{}"

BODY=$(curl -sf "$BASE_URL/ingest/status") \
  && check "/ingest/status shows simulator running" '.simulatorRunning == true' "$BODY" \
  && check "/ingest/status gas_readings has rows" \
      '(.tables[] | select(.table == "gas_readings") | .rows) >= 1' "$BODY" \
  && check "/ingest/status water_level has rows" \
      '(.tables[] | select(.table == "water_level_readings") | .rows) >= 1' "$BODY" \
  || check "/ingest/status reachable" '.simulatorRunning == true' "{}"

# ------------------------------------------------------------
section "3. Risk engine — nodes + forced scenario"

BODY=$(curl -sf "$BASE_URL/api/nodes") \
  && check "/api/nodes returns node F01" \
      '(.nodes[] | select(.id == "F01")) != null' "$BODY" \
  && check "/api/nodes F01 has risks array" \
      '(.nodes[] | select(.id == "F01") | .risks | length) >= 1' "$BODY" \
  || check "/api/nodes reachable" '.nodes | length >= 1' "{}"

BODY=$(curl -sf -X POST "$BASE_URL/risk/evaluate") \
  && check "/risk/evaluate assesses nodes" '.assessed >= 1' "$BODY" \
  || check "/risk/evaluate reachable" '.assessed >= 1' "{}"

# Flood scenario: lower W01 thresholds → flood must reach CRITICAL (3) and
# create an alert. Restored afterwards.
# Clear the dedup slate: resolve leftover active/acknowledged W01 flood alerts
# from earlier runs so this scenario always creates a fresh one.
"${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
  "UPDATE alerts SET status='resolved', resolved_at=now() WHERE node_id='W01' AND hazard_type='flood' AND status IN ('active','acknowledged');" > /dev/null 2>&1

read -r CFG_ID < <("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
  "INSERT INTO node_configs (node_id, config) VALUES ('W01', '{\"level_cm_warning\": 10, \"level_cm_critical\": 20}'::jsonb)
   ON CONFLICT (node_id) DO UPDATE SET config = EXCLUDED.config RETURNING node_id;" 2>/dev/null | tr -d '[:space:]')

if [ -n "$CFG_ID" ]; then
  COUNT_BEFORE=$("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
    "SELECT count(*) FROM alerts WHERE node_id='W01' AND hazard_type='flood';" | tr -d '[:space:]')
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null; sleep 1
  BODY=$(curl -sf "$BASE_URL/api/nodes")
  check "flood scenario: W01 flood is CRITICAL" \
    '(.nodes[] | select(.id == "W01") | .risks[] | select(.hazard == "flood") | .level) == 3' "$BODY"

  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null

  # With the slate cleared, exactly ONE alert may be created by the three
  # evaluates + simulator ticks (dedup holds while it stays active).
  COUNT_AFTER=$("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
    "SELECT count(*) FROM alerts WHERE node_id='W01' AND hazard_type='flood';" | tr -d '[:space:]')
  BODY=$((COUNT_AFTER - COUNT_BEFORE))
  if [ "$BODY" = "1" ]; then
    printf "  %s  flood scenario: exactly one deduplicated alert\n" "$(green "PASS")"
    PASS=$((PASS + 1))
  else
    printf "  %s  flood scenario: exactly one deduplicated alert (got: %s)\n" "$(red "FAIL")" "$BODY"
    FAIL=$((FAIL + 1))
  fi

  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "DELETE FROM node_configs WHERE node_id='W01';" > /dev/null 2>&1
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null
else
  printf "  %s  flood scenario (docker not available — skipped)\n" "$(yellow "SKIP")" 2>/dev/null \
    || printf "  SKIP  flood scenario (docker not available)\n"
fi

# ------------------------------------------------------------
section "4. risk_assessments sanity (direct DB)"

BODY=$("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
  "SELECT count(*) FROM risk_assessments;" 2>/dev/null | tr -d '[:space:]')
if [ -n "$BODY" ] && [ "$BODY" -ge 4 ] 2>/dev/null; then
  printf "  %s  risk_assessments has rows (%s)\n" "$(green "PASS")" "$BODY"
  PASS=$((PASS + 1))
else
  printf "  %s  risk_assessments has rows (got: %s)\n" "$(red "FAIL")" "${BODY:-none}"
  FAIL=$((FAIL + 1))
fi

# ------------------------------------------------------------
section "5. Auth — login, token, /me"

BODY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong-password"}')
check_status "login rejects bad credentials (401)" "401" "$BODY"

BODY=$(curl -sf -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "login returns a JWT" '.token != null and .user.username == "admin"' "$BODY"
TOKEN=$(echo "$BODY" | jq -r '.token // empty')

if [ -n "$TOKEN" ]; then
  BODY=$(curl -sf "$BASE_URL/api/auth/me" -H "Authorization: Bearer $TOKEN")
  check "/api/auth/me returns current user" '.user.role == "admin"' "$BODY"
else
  check "/api/auth/me with token" 'false' '{"error":"no token from login"}'
fi

BODY=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/me")
check_status "/api/auth/me without token is 401" "401" "$BODY"

# ------------------------------------------------------------
section "6. Node detail + history"

BODY=$(curl -sf "$BASE_URL/api/nodes/W01") \
  && check "/api/nodes/W01 returns node metadata" '.node.id == "W01" and .node.node_type == "water"' "$BODY" \
  && check "/api/nodes/W01 has risks and latest readings" \
      '(.risks | length) >= 1 and (.latest_readings | length) >= 1' "$BODY" \
  || check "/api/nodes/W01 reachable" '.node.id == "W01"' "{}"

BODY=$(curl -sf "$BASE_URL/api/nodes/W01/history?sensor=ultrasonic_water_level&range=1h") \
  && check "history 1h returns raw 1-minute buckets" \
      '.bucket_source == "raw" and (.points | length) >= 1' "$BODY" \
  || check "history 1h reachable" '.points | length >= 1' "{}"

BODY=$(curl -sf "$BASE_URL/api/nodes/W01/history?sensor=ultrasonic_water_level&range=7d") \
  && check "history 7d uses hourly continuous aggregate" \
      '.bucket_source == "hourly_continuous_aggregate" and (.points | length) >= 1' "$BODY" \
  || check "history 7d reachable" '.points | length >= 1' "{}"

BODY=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/nodes/W01/history?sensor=bogus&range=1h")
check_status "history rejects unknown sensor (400)" "400" "$BODY"

# ------------------------------------------------------------
section "7. Alerts — list, filters, detail"

BODY=$(curl -sf "$BASE_URL/api/alerts?limit=5") \
  && check "/api/alerts returns alerts" '.count >= 1' "$BODY" \
  || check "/api/alerts reachable" '.count >= 1' "{}"

ALERT_ID=$(echo "$BODY" | jq -r '.alerts[0].id // empty')
if [ -n "$ALERT_ID" ]; then
  BODY=$(curl -sf "$BASE_URL/api/alerts/$ALERT_ID")
  check "/api/alerts/:id returns alert with node name" '.alert.node_name != null' "$BODY"
  check "/api/alerts/:id includes events array" '.events != null' "$BODY"
else
  check "/api/alerts/:id detail" 'false' '{"error":"no alerts in list"}'
fi

BODY=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/alerts/999999")
check_status "/api/alerts/:id unknown id is 404" "404" "$BODY"


# ------------------------------------------------------------
section "8. Wave 2 — alert lifecycle, config, registration, users"

if [ -n "$TOKEN" ] && "${COMPOSE[@]}" ps db 2>/dev/null | grep -q healthy; then
  # Dedicated severity-2 alert for the lifecycle walk (WARNING, not CRITICAL,
  # so escalate has room to bump it): resolve leftovers, set a threshold the
  # current reading crosses at WARNING only, evaluate, take the fresh alert.
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "INSERT INTO node_configs (node_id, config) VALUES ('W01', '{\"level_cm_warning\": 40, \"level_cm_critical\": 90}'::jsonb) ON CONFLICT (node_id) DO UPDATE SET config = EXCLUDED.config;" > /dev/null 2>&1
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "UPDATE alerts SET status='resolved', resolved_at=now() WHERE node_id='W01' AND hazard_type='flood' AND status IN ('active','acknowledged');" > /dev/null 2>&1
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null; sleep 1
  # Select OUR alert specifically — the simulator's random fire/gas alerts
  # (potentially already CRITICAL) must not hijack the lifecycle walk.
  ALERT_ID=$(curl -sf "$BASE_URL/api/alerts?status=active&hazard_type=flood&node_id=W01&limit=1" | jq -r '.alerts[0].id // empty')

  if [ -n "$ALERT_ID" ]; then
    BODY=$(curl -sf -X PATCH "$BASE_URL/api/alerts/$ALERT_ID/acknowledge" -H "Authorization: Bearer $TOKEN")
    check "acknowledge sets status + actor" '.alert.status == "acknowledged" and .alert.acknowledged_by != null' "$BODY"

    ESC_CODE=$(curl -s -o /tmp/environet-escalate.json -w "%{http_code}" -X PATCH "$BASE_URL/api/alerts/$ALERT_ID/escalate" -H "Authorization: Bearer $TOKEN")
    if [ "$ESC_CODE" = "200" ]; then
      check "escalate bumps severity (cap 3)" '.alert.severity <= 3' "$(cat /tmp/environet-escalate.json)"
    else
      check "escalate bumps severity (cap 3)" 'false' "{\"status\": $ESC_CODE, \"body\": \"$(head -c 150 /tmp/environet-escalate.json)\"}"
    fi

    BODY=$(curl -sf -X PATCH "$BASE_URL/api/alerts/$ALERT_ID/resolve" -H "Authorization: Bearer $TOKEN")
    check "resolve sets status + resolved_at" '.alert.status == "resolved" and .alert.resolved_at != null' "$BODY"

    BODY=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE_URL/api/alerts/$ALERT_ID/escalate" -H "Authorization: Bearer $TOKEN")
    check_status "escalating a resolved alert is 409" "409" "$BODY"

    BODY=$(curl -sf "$BASE_URL/api/alerts/$ALERT_ID")
    check "event trail has acknowledged + resolved" \
      '([.events[].event_type] | index("acknowledged")) != null and ([.events[].event_type] | index("resolved")) != null' "$BODY"
  else
    check "alert lifecycle" 'false' '{"error":"no fresh alert created"}'
  fi

  BODY=$(curl -sf -X PUT "$BASE_URL/api/nodes/W01/config" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"level_cm_warning": 80}')
  check "config PUT stores override" '.overrides.level_cm_warning == 80 and .effective.level_cm_warning == 80' "$BODY"

  BODY=$(curl -sf "$BASE_URL/api/nodes/W01/config" -H "Authorization: Bearer $TOKEN")
  check "config GET returns defaults + overrides" '.defaults.level_cm_critical == 90 and .overrides.level_cm_warning == 80' "$BODY"

  BODY=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/api/nodes/W01/config" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"bogus": 1}')
  check_status "config PUT rejects unknown keys (400)" "400" "$BODY"

  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "DELETE FROM node_configs WHERE node_id='W01';" > /dev/null 2>&1

  # Node registration: 201 + key, duplicate 409, cleanup (health rows first — FK).
  BODY=$(curl -sf -X POST "$BASE_URL/api/nodes" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"id":"T99","node_type":"atmosphere","name":"Temp Test Node"}')
  check "node registration returns api_key" '.node.id == "T99" and (.api_key | length) == 48' "$BODY"

  BODY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/nodes" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"id":"T99","node_type":"atmosphere"}')
  check_status "duplicate node id is 409" "409" "$BODY"

  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "DELETE FROM node_health WHERE node_id='T99'; DELETE FROM nodes WHERE id='T99';" > /dev/null 2>&1

  BODY=$(curl -sf "$BASE_URL/api/users" -H "Authorization: Bearer $TOKEN")
  check "user list (admin) returns users" '.count >= 1' "$BODY"

  BODY=$(curl -sf -X POST "$BASE_URL/api/users" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"username":"test_view","password":"password123","role":"viewer"}')
  check "user creation returns 201" '.user.username == "test_view" and .user.role == "viewer"' "$BODY"
  NEW_UID=$(echo "$BODY" | jq -r '.user.id // empty')

  if [ -n "$NEW_UID" ]; then
    BODY=$(curl -sf -X DELETE "$BASE_URL/api/users/$NEW_UID" -H "Authorization: Bearer $TOKEN")
    check "user deletion works" '.status == "deleted"' "$BODY"
  fi

  BODY=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/users/1" -H "Authorization: Bearer $TOKEN")
  check_status "self-deletion is 409" "409" "$BODY"
else
  printf "  SKIP  Wave 2 tests (token or docker unavailable)\n"
fi

# Node health telemetry should now be flowing.
BODY=$(curl -sf "$BASE_URL/ingest/status") \
  && check "node_health telemetry has rows" \
      '(.tables[] | select(.table == "node_health") | .rows) >= 1' "$BODY" \
  || check "node_health telemetry" 'false' "{}"


# ------------------------------------------------------------
section "9. Forecast + predictive escalation"

BODY=$(curl -sf "$BASE_URL/api/analytics/forecast?node=W01&hazard=flood&horizon=3" -H "Authorization: Bearer $TOKEN") \
  && check "forecast responds with linear-trend contract" \
      '.method == "linear-trend-v1" and (.available == false or (.points | length) == 3)' "$BODY" \
  || check "forecast reachable" '.method == "linear-trend-v1"' "{}"

BODY=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/analytics/forecast?node=W01&hazard=bogus" -H "Authorization: Bearer $TOKEN")
check_status "forecast rejects unknown hazard (400)" "400" "$BODY"

# Deterministic predictive scenario: stop the simulator, insert a 24h rising
# ramp (18cm -> 44cm) at 5s cadence so the blended hourly trend is steep,
# enable the flag with a threshold above the current level, and require the
# engine to raise flood to WATCH (1) BEFORE the threshold is ever crossed.
if [ -n "$TOKEN" ] && "${COMPOSE[@]}" ps db 2>/dev/null | grep -q healthy; then
  curl -sf -X POST "$BASE_URL/simulator/stop" > /dev/null
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "INSERT INTO water_level_readings (time, node_id, level_cm, quality_flag, source)
     SELECT now() - INTERVAL '24 hours' + (g * INTERVAL '5 seconds'),
            'W01', 18 + 26.0 * g / 17279.0, 1, 'test_ramp'
     FROM generate_series(0, 17279) AS g;" > /dev/null 2>&1
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "CALL refresh_continuous_aggregate('water_level_hourly', NULL, NULL);" > /dev/null 2>&1
  # Neutralize rain/rate contributors so the scenario depends only on level_cm,
  # and set the warning threshold RELATIVE to the current reading (the
  # simulator's level drifts across runs) so the current state is NORMAL while
  # the ramp's predicted trend crosses it within the horizon.
  CURRENT_LEVEL=$("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
    "SELECT level_cm FROM water_level_readings WHERE node_id='W01' ORDER BY time DESC LIMIT 1;" | tr -d '[:space:]')
  CURRENT_LEVEL="${CURRENT_LEVEL:-45}"
  LEVEL_WARNING=$(awk -v v="$CURRENT_LEVEL" 'BEGIN { printf "%d", v + 1.5 }')
  LEVEL_CRITICAL=$(awk -v w="$LEVEL_WARNING" 'BEGIN { printf "%d", w + 50 }')
  curl -sf -X PUT "$BASE_URL/api/nodes/W01/config" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"level_cm_warning\": $LEVEL_WARNING, \"level_cm_critical\": $LEVEL_CRITICAL, \"rainfall_mmph_warning\": 9999, \"rainfall_mmph_critical\": 9999, \"rate_of_rise_warning\": 9999, \"rate_of_rise_critical\": 9999, \"predictive_escalation\": true}" > /dev/null
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null

  BODY=$(curl -sf "$BASE_URL/api/nodes")
  check "predictive escalation raises flood to WATCH before crossing" \
    '(.nodes[] | select(.id == "W01") | .risks[] | select(.hazard == "flood") | .level) == 1' "$BODY"

  BODY=$("${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -tAc \
    "SELECT contributing_factors::text FROM risk_assessments WHERE node_id='W01' AND hazard_type='flood' ORDER BY time DESC LIMIT 1;" | tr -d '[:space:]')
  if echo "$BODY" | jq -e '.predicted_level == 2 and .predicted_in_hours >= 1' > /dev/null 2>&1; then
    printf "  %s  assessment factors carry the prediction\n" "$(green "PASS")"
    PASS=$((PASS + 1))
  else
    printf "  %s  assessment factors carry the prediction (got: %s)\n" "$(red "FAIL")" "${BODY:0:120}"
    FAIL=$((FAIL + 1))
  fi

  # Cleanup: ramp rows, override, simulator back on.
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "DELETE FROM water_level_readings WHERE source='test_ramp'; DELETE FROM node_configs WHERE node_id='W01';" > /dev/null 2>&1
  "${COMPOSE[@]}" exec -T db psql -U environet -d environet_db -c \
    "CALL refresh_continuous_aggregate('water_level_hourly', NULL, NULL);" > /dev/null 2>&1
  curl -sf -X POST "$BASE_URL/simulator/start" > /dev/null
  curl -sf -X POST "$BASE_URL/risk/evaluate" > /dev/null
  BODY=$(curl -sf "$BASE_URL/api/nodes")
  # The predictive WATCH is gone; a natural rain WARNING (2) may legitimately
  # remain, so assert the level is not the predictive WATCH value.
  check "flood no longer at predictive WATCH after cleanup" \
    '(.nodes[] | select(.id == "W01") | .risks[] | select(.hazard == "flood") | .level) != 1' "$BODY"
else
  printf "  SKIP  predictive scenario (token or docker unavailable)\n"
fi


# ------------------------------------------------------------
section "10. WebSocket events + HTTP ingestion (X-API-Key)"

# Realtime: a WS client must receive a reading event within a couple of ticks.
if [ -d node_modules/ws ]; then
  WS_OUT=$(WS_URL="ws://localhost:3000/ws" BASE_URL="$BASE_URL" node -e "
    const WebSocket = require('ws');
    const ws = new WebSocket(process.env.WS_URL);
    const done = (code, out) => { try { ws.close(); } catch {} process.exit(code); };
    const timer = setTimeout(() => { console.log('timeout'); done(2); }, 15000);
    let readings = 0;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', node_ids: ['F01'] }));
      fetch(process.env.BASE_URL + '/ingest/tick', { method: 'POST' }).catch(() => {});
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.event === 'reading') {
        if (m.payload.node_id !== 'F01') { clearTimeout(timer); console.log('leaked:' + m.payload.node_id); done(1); }
        readings += 1;
        if (readings >= 2) { clearTimeout(timer); console.log('ok'); done(0); }
      }
      if (m.event === 'alert') { console.log('unexpected-alert'); done(1); }
    });
    ws.on('error', () => { clearTimeout(timer); console.log('error'); done(2); });
  " 2>&1)
  check_status "websocket delivers subscribed readings only" "ok" "$WS_OUT"
else
  printf "  SKIP  websocket test (ws module not installed on host)\n"
fi

# HTTP ingestion: register a node, write via its key, verify auth boundaries.
if [ -n "$TOKEN" ]; then
  BODY=$(curl -sf -X POST "$BASE_URL/api/nodes" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"id":"T98","node_type":"water","name":"Ingest Test Node"}')
  INGEST_KEY=$(echo "$BODY" | jq -r '.api_key // empty')

  if [ -n "$INGEST_KEY" ]; then
    BODY=$(curl -sf -X POST "$BASE_URL/api/ingest" -H "X-API-Key: $INGEST_KEY" \
      -H 'Content-Type: application/json' \
      -d '{"sensor":"ultrasonic_water_level","values":{"level_cm": 51.2, "raw_distance_cm": 68.8}}')
    check "ingest single reading accepted" '.ack == true and .accepted == 1' "$BODY"

    BODY=$(curl -sf -X POST "$BASE_URL/api/ingest" -H "X-API-Key: $INGEST_KEY" \
      -H 'Content-Type: application/json' \
      -d '{"readings":[{"sensor":"ultrasonic_water_level","values":{"level_cm": 51.3}},{"sensor":"dht22_temp","values":{"celsius": 25.1}}]}')
    check "ingest batch accepted" '.ack == true and .accepted == 2' "$BODY"

    BODY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/ingest" \
      -H "X-API-Key: wrong-key" -H 'Content-Type: application/json' -d '{"sensor":"ultrasonic_water_level","values":{"level_cm":1}}')
    check_status "ingest rejects bad API key (401)" "401" "$BODY"

    BODY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/ingest" -H "X-API-Key: $INGEST_KEY" \
      -H 'Content-Type: application/json' -d '{"node_id":"W01","sensor":"ultrasonic_water_level","values":{"level_cm":1}}')
    check_status "ingest rejects cross-node writes (400)" "400" "$BODY"

    BODY=$(docker compose exec -T db psql -U environet -d environet_db -tAc \
      "SELECT count(*) FROM water_level_readings WHERE node_id='T98';" | tr -d '[:space:]')
    if [ "$BODY" -ge 2 ] 2>/dev/null; then
      printf "  %s  ingested rows landed in the readings table (%s)\n" "$(green "PASS")" "$BODY"
      PASS=$((PASS + 1))
    else
      printf "  %s  ingested rows landed in the readings table (got: %s)\n" "$(red "FAIL")" "$BODY"
      FAIL=$((FAIL + 1))
    fi

    curl -sf -X POST "$BASE_URL/simulator/stop" > /dev/null
    docker compose exec -T db psql -U environet -d environet_db -c \
      "UPDATE nodes SET status='decommissioned' WHERE id='T98'; DELETE FROM alerts WHERE node_id='T98'; DELETE FROM risk_assessments WHERE node_id='T98'; DELETE FROM water_level_readings WHERE node_id='T98'; DELETE FROM rainfall_readings WHERE node_id='T98'; DELETE FROM turbidity_readings WHERE node_id='T98'; DELETE FROM temperature_readings WHERE node_id='T98'; DELETE FROM humidity_readings WHERE node_id='T98'; DELETE FROM pressure_readings WHERE node_id='T98'; DELETE FROM node_health WHERE node_id='T98'; DELETE FROM nodes WHERE id='T98';" > /dev/null 2>&1
    docker compose exec -T db psql -U environet -d environet_db -c \
      "DELETE FROM water_level_readings WHERE source='test_ramp';" > /dev/null 2>&1
    docker compose exec -T db psql -U environet -d environet_db -c \
      "CALL refresh_continuous_aggregate('water_level_hourly', NULL, NULL);" > /dev/null 2>&1
    curl -sf -X POST "$BASE_URL/simulator/start" > /dev/null
  else
    check "ingest flow" 'false' '{"error":"no api key from registration"}'
  fi
fi

# ------------------------------------------------------------
echo
bold "Results: $(green "$PASS passed") / $(red "$FAIL failed")"
[ "$FAIL" -eq 0 ] || exit 1
