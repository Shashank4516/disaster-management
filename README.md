# EnviroNet

**A resilient, AI-powered environmental intelligence network** — SIH 26178.

Authority dashboard for live flood, forest-fire, and air-quality risk. The React app reads nodes, sensor history, and alerts from **Environet-BE** (Express + TimescaleDB). A built-in simulator writes sensor readings continuously so maps and charts stay live without physical hardware.

---

## Architecture

```
┌─────────────────────┐         Vite proxy /ws + /api         ┌──────────────────────┐
│  Dashboard (Vite)   │ ───────────────────────────────────► │  Environet-BE API    │
│  localhost:5173     │                                       │  localhost:3000      │
└─────────────────────┘                                       └──────────┬───────────┘
                                                                         │
                                                                         ▼
                                                              ┌──────────────────────┐
                                                              │  TimescaleDB         │
                                                              │  localhost:5432      │
                                                              └──────────────────────┘
```

| Layer | Stack |
| --- | --- |
| Frontend | React 19, Vite 8, React Router, Leaflet, ApexCharts, Bootstrap / Dashbyte |
| API | Node.js, Express, JWT auth, WebSocket (`/ws`) |
| Database | TimescaleDB on PostgreSQL 18 |

Backend source lives in [`Environet-BE/`](./Environet-BE). Full HTTP contract: [`Environet-BE/API.md`](./Environet-BE/API.md).

---

## Prerequisites

- **Node.js** 20 or newer
- **npm** 10 or newer
- **Docker Desktop** (API + database)

Ports that must be free:

| Port | Service |
| --- | --- |
| `5173` | Dashboard (Vite) |
| `3000` | Environet-BE API |
| `5432` | TimescaleDB |

---

## Quick start

From this directory (`enviromental/`):

```bash
npm install
npm run backend      # Docker: API :3000 + TimescaleDB :5432
npm run dev          # Dashboard :5173
```

One shot:

```bash
npm install && npm run dev:full
```

| URL | Purpose |
| --- | --- |
| http://localhost:5173 | Authority dashboard |
| http://localhost:3000/health | API liveness |
| http://localhost:3000/db/health | Database connectivity |
| http://localhost:3000/api/nodes | Nodes + fused risk |
| http://localhost:3000/ingest/status | Simulator + row counts |

Default operator login (acknowledge / resolve / escalate): **`admin` / `admin123`**. Change this before any shared or production deploy.

---

## First-time database

A fresh Timescale container only enables the extension. Apply schema, migrations, and seed **once** after the first successful `npm run backend`:

```bash
DB=environet-be-db-1
BE=Environet-BE

docker cp "$BE/schema.sql" $DB:/tmp/schema.sql
docker exec $DB psql -U environet -d environet_db -v ON_ERROR_STOP=1 -f /tmp/schema.sql

for f in "$BE"/db/migrations/*.sql; do
  docker cp "$f" $DB:/tmp/migration.sql
  docker exec $DB psql -U environet -d environet_db -v ON_ERROR_STOP=1 -f /tmp/migration.sql
done

docker cp "$BE/db/seed.sql" $DB:/tmp/seed.sql
docker exec $DB psql -U environet -d environet_db -v ON_ERROR_STOP=1 -f /tmp/seed.sql
docker restart environet-be-api-1
```

After that, `GET /api/nodes` should return `F01` (forest) and `W01` (water). You do **not** repeat this on every restart — data lives in the Docker volume.

---

## Verify live storage

The API simulator writes a reading for every sensor every few seconds (`source = 'simulated'`).

```bash
curl -s http://localhost:3000/ingest/status
```

Expect `"simulatorRunning": true`, `rows` &gt; 0, and `latest` close to now. Run it again after ~10 seconds — **row counts should increase**.

Inspect Postgres:

```bash
docker exec -it environet-be-db-1 psql -U environet -d environet_db
```

```sql
SELECT time, node_id, level_cm FROM water_level_readings ORDER BY time DESC LIMIT 5;
SELECT count(*) FROM gas_readings;
```

Host connection: `postgres://environet:environet@localhost:5432/environet_db`.

---

## Stop and start

From this folder:

```bash
npm run backend:down     # stop API + DB (volume kept)
npm run backend          # start again
npm run backend:logs     # follow API logs
```

From `Environet-BE/` directly:

```bash
npm run stack:down
npm run stack:up
```

Wipe the database (destructive):

```bash
cd Environet-BE && docker compose down -v && npm run stack:up
```

Then re-run the first-time schema steps above.

---

## npm scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with API proxy |
| `npm run backend` | Start Environet-BE (`stack:up`) |
| `npm run backend:down` | Stop Environet-BE |
| `npm run backend:logs` | Tail API container logs |
| `npm run dev:full` | Backend then Vite |
| `npm run build` | Production frontend bundle → `dist/` |
| `npm run preview` | Serve `dist/` (same proxy as dev) |
| `npm run lint` | ESLint |

---

## Environment

Copy [`.env.example`](./.env.example) to `.env` only if you need overrides. In local dev, **leave `VITE_API_URL` unset** so the browser calls same-origin `/api` and Vite proxies to `localhost:3000`.

| Variable | Default | Role |
| --- | --- | --- |
| `VITE_API_URL` | *(empty — use proxy)* | Absolute API origin |
| `VITE_AUTH_USERNAME` | `admin` | Auto-login for protected routes |
| `VITE_AUTH_PASSWORD` | `admin123` | Auto-login password |

Backend secrets (`JWT_SECRET`, `AUTH_ADMIN_*`, `POSTGRES_*`) belong in `Environet-BE/.env`. See [`Environet-BE/.env.example`](./Environet-BE/.env.example).

---

## Dashboard

| Route | Screen |
| --- | --- |
| `/` | Network overview — KPIs, regional map, live alerts |
| `/sensors` | Regional risk map + node table |
| `/raw-sensors` | Raw sensor catalog — type, job, latest values, history |
| `/node/:nodeId` | Node identity, health, live readings, history |
| `/alerts` | Filter, acknowledge, escalate, resolve |
| `/hazards` | Flood / fire / air-quality modules |
| `/settings` | Connection, operator login, stack status |

Public reads (`GET /api/nodes`, `GET /api/sensors`, `GET /api/alerts`, history) need no token. Alert mutations require a JWT from `POST /api/auth/login`.

---

## Production notes

- Change `AUTH_ADMIN_PASSWORD` and `JWT_SECRET` before any non-local deploy.
- Serve the Vite `dist/` build behind TLS. Point the UI at the API with `VITE_API_URL` **or** put both behind the same reverse proxy (`/api` → backend, `/` → static).
- The backend does not enable CORS. Same-origin proxy (nginx, Caddy, or Vite in preview) is required.
- Treat simulator data as demo only. Real nodes ingest with `POST /api/ingest` and `X-API-Key`.
- Default credentials in this README are **development only**.

```bash
npm run build
npm run preview    # local check of the production bundle
```

---

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `Bind for 0.0.0.0:3000 failed: port is already allocated` | Another container owns 3000. `docker ps --filter publish=3000` then `docker stop <name>`. Retry `npm run backend`. |
| `Missing script: "backend"` | You are inside `Environet-BE/`. Use `npm run stack:up`, or `cd ..` and run `npm run backend`. |
| `/api/nodes` → `relation "nodes" does not exist` | Schema was never applied. Run the **First-time database** steps. |
| `/db/health` returns 503 | Wait ~30s after first boot, then retry. |
| Dashboard “Backend unreachable” | Confirm `curl http://localhost:3000/health`, then restart Vite. |
| Port 5432 in use | Stop local PostgreSQL or the other Docker DB. Environet-BE expects host port **5432**. |

---

## Project layout

```
.
├── src/                    # Dashboard
│   ├── pages/              # Overview, map, raw sensors, node detail, alerts, hazards, settings
│   ├── hooks/              # Live network + node history (API + WebSocket)
│   ├── lib/api.js          # HTTP client for Environet-BE
│   └── lib/adaptNetwork.js # API JSON → UI models
├── Environet-BE/           # Express API + TimescaleDB (Docker Compose)
├── vite.config.js          # Dev/preview proxy to localhost:3000
└── package.json
```

---

## License

Private SIH project. Backend: [Penguin5681/Environet-BE](https://github.com/Penguin5681/Environet-BE).
