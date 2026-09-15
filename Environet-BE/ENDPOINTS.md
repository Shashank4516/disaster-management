# API Endpoint Reference — Environmental Intelligence Network

**Project:** SIH26178 — A Resilient, AI-Powered Environmental Intelligence Network

This document lists every endpoint the backend is expected to expose, grouped by purpose.
It reflects the contract already proven against the mock server, plus additional endpoints
identified during architecture discussions (ingestion, auth, alerts, node configuration,
analytics). Request/response bodies are described conceptually — exact field names should
follow the schema already defined in `schema.sql` and `frontend-requirements.md`.

---

## 1. Read / Query Endpoints

These match the contract already implemented by the mock server. The frontend should not
need any code changes when pointed at the real backend, only a base URL change.

### `GET /api/nodes`
Returns a list of all nodes with their current status.
**Response:** array of node objects — id, type, location, current risk level per hazard,
online/offline status, last-updated timestamp.
**Used by:** Citizen home map, Authority dashboard, Authority regional risk map.

### `GET /api/nodes/:id`
Returns full detail for a single node, including latest sensor readings and health status.
**Response:** node metadata + latest readings across all its sensors + risk classification.
**Used by:** Authority Node Detail page, Citizen Area Detail page (simplified subset).

### `GET /api/nodes/:id/history?range=`
Returns time-series data for a node over a selectable range (e.g. `1h`, `24h`, `7d`).
Should query continuous aggregates, not raw tables, for anything beyond a short range.
**Response:** array of timestamped readings/aggregated buckets.
**Used by:** Node Detail trend charts, Historical Analytics page.

### `GET /api/alerts`
Returns alert records, filterable by query params (severity, hazard type, node, status,
date range).
**Response:** array of alert objects — id, node_id, hazard_type, severity, message,
timestamp, status.
**Used by:** Citizen Alerts Near Me page, Authority Alert Management page.

### `GET /api/alerts/:id`
Returns full detail for a single alert, including status history if tracked.
**Used by:** Alert Management detail view (optional, lower priority).

### `GET /api/analytics/forecast?region=&hazard=`
Returns forecast output from the server-side predictive model — predicted risk level,
time horizon, confidence.
**Response:** forecast object per region/hazard combination.
**Used by:** Historical Analytics page (forecasting section).

### `GET /health`
Basic health check — confirms the API and its DB connection are up.
**Response:** `{ status: "ok", db: "connected" }` or equivalent.
**Used by:** Ops/monitoring, load balancers if ever deployed behind one.

---

## 2. Ingestion Endpoints (write path — sensor data entering the system)

### `POST /api/ingest`
Accepts a single sensor reading or a small batch, validates it, and writes into the
correct sensor table (e.g. `water_level_readings`, `gas_readings`) based on payload type.
Primary use: manual testing, backfill scripts, and as an HTTP fallback if MQTT is
unavailable.
**Request body:** node_id, sensor readings (raw + derived values), timestamp, source
(`real` or `simulated`).
**Response:** `{ ack: true }` or validation error.

### MQTT topics (not HTTP endpoints, but part of the ingestion contract)
- `nodes/forest/:nodeId/telemetry` — Forest node sensor readings
- `nodes/water/:nodeId/telemetry` — Water node sensor readings
- `nodes/atmosphere/:nodeId/telemetry` — Atmosphere node sensor readings (future)
- `nodes/:nodeId/heartbeat` — lightweight periodic "node is alive" message
- `nodes/:nodeId/health` — battery, signal strength, uptime

A subscriber process listens on these topics and calls the same validation/write logic
used by `POST /api/ingest`, so the two paths stay consistent.

---

## 3. Authentication Endpoints

### `POST /api/auth/login`
Authenticates an authority/operator user.
**Request body:** username, password.
**Response:** JWT token (or session token) + basic user info.
**Used by:** Authority Login page.

### `POST /api/auth/logout` (optional, depends on session strategy)
Invalidates the current session/token if using server-side session tracking.

### `GET /api/auth/me`
Returns the currently authenticated user's info, for session validation on page load.
**Used by:** Authority portal route guards.

---

## 4. Alert Management Endpoints (Authority-only, requires auth)

### `PATCH /api/alerts/:id/acknowledge`
Marks an alert as acknowledged by the current authenticated user.
**Request body:** none required beyond auth token.
**Response:** updated alert object.

### `PATCH /api/alerts/:id/resolve`
Marks an alert as resolved.
**Request body:** optional resolution note.
**Response:** updated alert object.

### `PATCH /api/alerts/:id/escalate` (optional, lower priority)
Escalates an alert's severity or notifies additional recipients.

---

## 5. Node Configuration Endpoints (Authority-only — supports the feedback loop)

These support the edge/server feedback loop discussed in the architecture: the server
can push updated thresholds or polling behavior back down to a node.

### `GET /api/nodes/:id/config`
Returns the current threshold/config values for a node (e.g. warning/critical thresholds
per sensor, polling interval).
**Used by:** Authority Settings page.

### `PUT /api/nodes/:id/config`
Updates a node's configuration. The backend should publish the new config to the node's
MQTT config topic (e.g. `nodes/:nodeId/config`) so the node picks it up on next check-in.
**Request body:** threshold values, polling interval, or other tunable parameters.
**Response:** confirmation + the config that will be pushed to the node.

### `POST /api/nodes` (registering a new node)
Adds a new node to the system — required when physically deploying additional nodes.
**Request body:** node id, type, location, deployment metadata.
**Used by:** Authority Settings page (node registration).

---

## 6. User Management Endpoints (Authority-only, lower priority)

### `GET /api/users`
Lists authority/operator users.

### `POST /api/users`
Creates a new authority user account.

### `DELETE /api/users/:id`
Removes a user's access.

---

## 7. WebSocket Events (not REST, but part of the live-data contract)

### `reading` (server → client)
Pushed whenever a new sensor reading is ingested for a node. Same shape as the node
object returned by `GET /api/nodes/:id`, so the frontend can reuse existing rendering
logic for both the initial fetch and live updates.

### `alert` (server → client)
Pushed whenever a new alert is triggered, so the dashboard can surface it immediately
without waiting for a poll or page refresh.

### `node_status` (server → client, optional)
Pushed when a node's online/offline status changes, separate from a full reading update.

---

## Summary Table

| Category | Endpoint | Method | Auth required? |
|---|---|---|---|
| Read | `/api/nodes` | GET | No |
| Read | `/api/nodes/:id` | GET | No |
| Read | `/api/nodes/:id/history` | GET | No |
| Read | `/api/alerts` | GET | No |
| Read | `/api/alerts/:id` | GET | No |
| Read | `/api/analytics/forecast` | GET | No |
| Read | `/health` | GET | No |
| Ingestion | `/api/ingest` | POST | Yes (node API key) |
| Auth | `/api/auth/login` | POST | No |
| Auth | `/api/auth/logout` | POST | Yes |
| Auth | `/api/auth/me` | GET | Yes |
| Alerts | `/api/alerts/:id/acknowledge` | PATCH | Yes |
| Alerts | `/api/alerts/:id/resolve` | PATCH | Yes |
| Alerts | `/api/alerts/:id/escalate` | PATCH | Yes |
| Node config | `/api/nodes/:id/config` | GET | Yes |
| Node config | `/api/nodes/:id/config` | PUT | Yes |
| Node config | `/api/nodes` | POST | Yes |
| Users | `/api/users` | GET | Yes |
| Users | `/api/users` | POST | Yes |
| Users | `/api/users/:id` | DELETE | Yes |

**Note on "Auth required?" for citizen-facing reads:** these are intentionally public
(no login) since the Citizen Portal has no authentication layer — this is by design, not
an oversight.