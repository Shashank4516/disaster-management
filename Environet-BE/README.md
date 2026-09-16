# EnvironetBE

A TypeScript backend built with [Express](https://expressjs.com/) and Node.js. Ships with `/health` (liveness), `/db/health` (TimescaleDB check), and a **live mock ingestion simulator** that continuously writes realistic readings for every sensor into the database, so charts and history have data out of the box.

**Full API reference with request/response examples: [API.md](API.md).**

## Requirements

| Option | Requirements |
| --- | --- |
| Docker | [Docker](https://docs.docker.com/get-docker/) with Compose (included in Docker Desktop) |
| Local (no Docker) | Node.js >= 20 and npm (the database still runs in Docker, or point `DATABASE_URL` at your own Postgres) |

## Ports

| Service | Port |
| --- | --- |
| API | `3000` (fixed) |
| Database | `5432` (fixed) |

## Quick start (Docker)

The clean-start script stops any previous run, frees the service ports (killing whatever occupies them), then builds and starts the full stack:

```bash
npm run stack:up
```

- API: [http://localhost:3000/health](http://localhost:3000/health)
- DB check: [http://localhost:3000/db/health](http://localhost:3000/db/health)

Stop the stack (data is kept):

```bash
npm run stack:down
```

> **Note:** if port `5432` is held by a system-level process the script cannot kill (e.g. a native PostgreSQL service), it will tell you the exact `sudo` command to run and exit. After stopping it, re-run `npm run stack:up`.

You can also use plain Compose if the ports are already free:

```bash
docker compose up --build -d
docker compose down
```

## Database

The `db` service is built from [`Dockerfile.db`](Dockerfile.db), based on the official `timescale/timescaledb:latest-pg18` image (TimescaleDB on PostgreSQL 18). On first start it creates:

| Setting | Value |
| --- | --- |
| Database | `environet_db` |
| User | `environet` |
| Password | `environet` |
| Host port | `5432` (same as the container's internal port) |

The `timescaledb` extension is enabled automatically, and data persists in the `db_data` named volume across `docker compose down` (delete it with `docker compose down -v`).

Credentials can be overridden via environment variables (see [.env.example](.env.example)): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

### Connect from the host

```bash
psql -h localhost -p 5432 -U environet -d environet_db
```

Verify TimescaleDB is active:

```sql
SELECT timescaledb_version();
```

## Run without Docker

### Development (hot reload)

```bash
npm install
npm run dev
```

Starts the API with `tsx watch` (auto-restart on change) at [http://localhost:3000/health](http://localhost:3000/health). Port `3000` must be free (or pass a different one with `PORT=<port>`).

If the database runs in Docker (`docker compose up -d db`) and the app runs on your host, the default connection string already points at `localhost:5432`. Otherwise set `DATABASE_URL` explicitly:

```bash
DATABASE_URL=postgres://environet:environet@localhost:5432/environet_db npm run dev
```

Environment variables can also live in a `.env` file — copy [.env.example](.env.example) to `.env` and adjust.

### Production build

```bash
npm install
npm run build   # compiles TypeScript to dist/
npm start       # runs node dist/index.js
```

## Automated releases (GitHub Actions)

[.github/workflows/release.yml](.github/workflows/release.yml) automates the whole distribution flow. Trigger it by pushing a tag (`v0.5.0`) or running it manually (Actions → Release → Run workflow → version). It then:

1. Builds a **clean database snapshot** from scratch: fresh TimescaleDB 18 container + `schema.sql` + all `db/migrations/*.sql` + `db/seed.sql` → `pg_dump` (no accumulated test data ships to the frontend).
2. Builds and pushes both images to Docker Hub: `penguin5681/environet:api-<version>` / `db-<version>` (+ `api-latest` / `db-latest`).
3. Bumps the image tags in the **frontend compose repo** (`penguin5681/Environet-DockerCompose`) and pushes — so the frontend team just runs `docker compose pull && docker compose up -d` after pulling.

**One-time setup (GitHub repo → Settings → Secrets and variables → Actions):**

| Secret | Value |
| --- | --- |
| `DOCKERHUB_USERNAME` | Your Docker Hub username with push access |
| `DOCKERHUB_TOKEN` | Docker Hub access token with **Read & Write** scope (hub.docker.com → Account Settings → Personal access tokens) |
| `COMPOSE_REPO_PAT` | GitHub PAT with **Contents: read/write** on the compose repo |

The compose repo path is set via the `COMPOSE_REPO` env in the workflow file — adjust if the account/name differs.

## Private registry (LAN fallback, optional)

A self-hosted private Docker registry also runs on this machine for LAN/Tailscale distribution (kept as a fallback): `npm run registry:up` starts it on port 5000 with basic auth (accounts `admin`/`frontend`; hashes in `registry/auth/`, gitignored). For building and pushing releases by hand — e.g. when you want the *current live database state* (including accumulated readings) baked in rather than a clean baseline — use:

```bash
npm run stack:up                                                    # snapshot source must be running
REGISTRY=localhost:5000 VERSION=0.1.0 ./scripts/package-release.sh --push
```

The GitHub Actions pipeline is the recommended path; it always ships a clean, freshly migrated database.

## API

### `GET /health`

Process liveness. Always `200 OK` while the server is running.

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "uptime": 4.253837314,
  "timestamp": "2026-09-06T20:43:11.613Z"
}
```

### `GET /db/health`

Database connectivity check. `200 OK` when the database is reachable, `503 Service Unavailable` when it is not.

```bash
curl http://localhost:3000/db/health
```

```json
{
  "status": "up",
  "pgVersion": "PostgreSQL 18.x (Debian ...) on x86_64-pc-linux-gnu, ...",
  "timescaledbVersion": "2.29.2",
  "latencyMs": 2
}
```

| Field | Description |
| --- | --- |
| `status` | `up` or `down` |
| `pgVersion` | PostgreSQL server version string |
| `timescaledbVersion` | Installed TimescaleDB extension version (`null` if not installed) |
| `latencyMs` | Round-trip time of the check query in milliseconds |

## Mock data / live ingestion

A built-in simulator (`src/simulator.ts`) generates realistic readings for **every sensor on every active node** and writes them to the database continuously — random walks with mean reversion, a day/night temperature cycle, occasional gas spikes, rare rain episodes (which raise water level and turbidity), rare flame blips, and ~2% suspect readings flagged `quality_flag = 0`. It auto-starts with the API; disable with `SIMULATOR_DISABLED=true`.

It inserts through the same path real sensors will use — `INSERT ... ON CONFLICT (time, node_id) DO UPDATE`, so retried transmissions overwrite instead of duplicating (NEXT_STEPS.md §6) — and every simulated row is marked `source = 'simulated'`. When real nodes arrive they write `source = 'real'` into the same tables with no schema or frontend changes; operational queries should filter `WHERE source = 'real'`.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/nodes` | GET | — | All nodes with latest fused risk level per hazard (0=NORMAL 1=WATCH 2=WARNING 3=CRITICAL) |
| `/api/nodes/:id` | GET | — | Node detail: metadata, config, risks, health, latest reading per sensor |
| `/api/sensors` | GET | — | Mounted sensor catalog + latest raw sample (quality, source, analog values) |
| `/api/nodes/:id/history?sensor=&range=` | GET | — | Time series — `sensor`: registry name (e.g. `ultrasonic_water_level`), `range`: `1h`/`6h`/`24h` (raw buckets) or `7d`/`30d` (hourly continuous aggregates) |
| `/api/nodes/:id/config` | GET/PUT | 🔒 | Threshold configuration (the authority feedback loop) |
| `/api/nodes` | POST | 🔒 | Register a node — generates its ingestion API key |
| `/api/alerts` | GET | — | Alerts, filterable: `severity`, `hazard_type`, `node_id`, `status`, `from`, `to`, `limit` |
| `/api/alerts/:id` | GET | — | Alert detail with full event history (`alert_events`) |
| `/api/alerts/:id/acknowledge\|resolve\|escalate` | PATCH | 🔒 | Alert lifecycle transitions |
| `/api/auth/login` | POST | — | `{username, password}` → JWT (seeded admin: `admin`/`admin123` via env) |
| `/api/auth/me` | GET | 🔒 | Current user (Bearer token) |
| `/api/users` | GET/POST | 🔒 admin | List / create operator accounts |
| `/api/users/:id` | DELETE | 🔒 admin | Remove an account (audit history blocks deletion) |
| `/api/analytics/forecast?node=&hazard=&horizon=` | GET | 🔒 | Heuristic 1–6h risk forecast (`linear-trend-v1`) |
| `/api/ingest` | POST | 🔒 (X-API-Key) | Node write path — single reading or batch (this is what real sensors call) |
| `/risk/evaluate` | POST | — | Run one risk-engine evaluation immediately (demos/tests) |
| `/ingest/status` | GET | — | Row count + newest timestamp for each reading table |
| `/ingest/tick` | POST | — | Run one ingestion cycle immediately (demos/tests) |
| `/simulator/start` · `/simulator/stop` | POST | — | Control the mock-data loop |
| `ws://…/ws` | WebSocket | — | Live push: `reading`, `alert`, `node_status` events (client can subscribe per node) |

**Full details with request/response examples: [API.md](API.md).**

```bash
curl -X POST http://localhost:3000/ingest/tick   # {"status":"ok","readingsWritten":12}
curl http://localhost:3000/ingest/status
```

## Risk engine

After every ingestion cycle the risk engine (`src/riskEngine.ts`) evaluates each active node's newest readings against **per-node thresholds** and writes fused `risk_assessments` rows (per node × hazard: `fire`/`flood`/`air_quality`). Rules:

- A sensor crossing its warning threshold makes the hazard **WARNING (2)**; crossing critical, or **two concurrent warnings**, makes it **CRITICAL (3)**. Forest fire fuses gas + soil dryness + temperature; flood fuses water level + rate-of-rise + rainfall; air quality fuses gas (forest) or turbidity (water).
- When a hazard reaches WARNING/CRITICAL and no active/acknowledged alert for that node+hazard exists in the past hour, an `alerts` row is created (deduplicated — repeated evaluations do not spam).
- Thresholds live in `node_configs.config` (JSONB) per node; unset keys fall back to defaults in `DEFAULT_THRESHOLDS`. This is the storage behind ENDPOINTS.md §5's `GET/PUT /api/nodes/:id/config` feedback loop.
- **Predictive escalation** (off by default, enable with `{"predictive_escalation": true}` in a node's config): the engine also runs the heuristic forecast (last 24h linear trend) and lifts the level *before* any threshold is crossed — a predicted WARNING within 6h raises NORMAL → WATCH (1), a predicted CRITICAL raises it to WARNING (2). The prediction is recorded in `contributing_factors`.

```bash
curl http://localhost:3000/api/nodes          # risks per node
curl -X POST http://localhost:3000/risk/evaluate
```

Demo recipe (force a flood scenario on W01):

```sql
INSERT INTO node_configs (node_id, config) VALUES ('W01', '{"level_cm_warning": 10, "level_cm_critical": 20}'::jsonb)
ON CONFLICT (node_id) DO UPDATE SET config = EXCLUDED.config;
```

…then `POST /risk/evaluate` (or wait one cycle): W01 flood goes CRITICAL and an alert appears. Delete the row to restore defaults.

## Project structure

```
.
├── src/
│   ├── index.ts        # Express app: routes, simulator control, graceful shutdown
│   ├── db.ts           # pg connection pool + database check
│   ├── simulator.ts    # live mock ingestion (realistic readings + node health, all sensors)
│   ├── riskEngine.ts   # threshold evaluation, hazard fusion, predictive escalation, alerts
│   ├── forecast.ts     # linear-trend heuristic over hourly aggregates
│   ├── realtime.ts     # WebSocket push: reading / alert / node_status events
│   ├── nodes.ts        # node detail, history, config, registration
│   ├── sensors.ts      # GET /api/sensors catalog + latest raw samples
│   ├── alerts.ts       # alert list/detail + acknowledge/resolve/escalate
│   ├── auth.ts         # JWT login/me, admin seeding, requireAuth/requireAdmin
│   ├── analytics.ts    # forecast endpoint
│   └── ingest.ts       # POST /api/ingest (X-API-Key node write path)
├── db/
│   ├── init/           # SQL run once on first database startup
│   ├── migrations/     # 001 risk-engine objects, 002 alert events + caggs, 003 compression/retention
│   ├── seed.sql        # idempotent reference data (nodes, sensor types, instances)
│   └── snapshot/       # pg_dump baked into release DB images (gitignored; CI regenerates)
├── deploy/             # team-facing compose + handoff README (see Environet-DockerCompose repo)
├── registry/           # self-hosted private Docker registry (LAN fallback, port 5000)
├── scripts/
│   ├── clean-start.sh      # npm run stack:up — free ports, then start the stack
│   ├── package-release.sh  # snapshot DB + build + push release images (manual path)
│   └── test-api.sh         # npm run test:api — 52-check API smoke suite
├── .github/workflows/release.yml  # CI: snapshot → build → smoke-test gate → push → sync compose repo
├── dist/               # Compiled output (created by npm run build)
├── Dockerfile          # Multi-stage image for the API
├── Dockerfile.db       # TimescaleDB (PostgreSQL 18) database image
├── Dockerfile.db-seeded # DB image with the snapshot baked in (release builds)
├── docker-compose.yml  # dev stack: api (port 3000) + db (port 5432)
├── API.md              # full API reference with examples
├── ENDPOINTS.md        # original API contract (fully implemented except MQTT)
├── NEXT_STEPS.md       # post-schema roadmap (mostly complete)
├── schema.sql          # TimescaleDB schema (12 hypertables)
├── package.json
└── tsconfig.json
```

## Available scripts

| Script | Description |
| --- | --- |
| `npm run stack:up` | Clean start: stop previous run, kill port squatters, build & start the full stack |
| `npm run stack:down` | Stop the stack (keeps database data) |
| `npm run test:api` | API smoke tests against `http://localhost:3000` (or `BASE_URL=... npm run test:api`) |
| `npm run dev` | Start the API with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |
