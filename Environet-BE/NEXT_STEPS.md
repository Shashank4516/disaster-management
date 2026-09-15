# Database Setup — Next Steps

**Project:** SIH26178 — Environmental Intelligence Network
**Scope:** Post-schema setup for TimescaleDB, including the mock-data-to-real-sensor transition plan.

**Context:** The schema (`schema.sql`) has already been applied to the database. This document
covers what to do next, and how the system is designed to swap from mock/simulated data to real
sensor data later without any schema or application changes.

---

## 1. Verify Hypertables Were Actually Created

Run the following in `psql` before doing anything else, to confirm the schema applied correctly:

```sql
-- Confirm the TimescaleDB extension is active
\dx

-- List all hypertables and confirm every sensor table appears
SELECT * FROM timescaledb_information.hypertables;
```

Every reading table (`flame_readings`, `gas_readings`, `soil_moisture_readings`,
`water_level_readings`, `rainfall_readings`, `turbidity_readings`, `temperature_readings`,
`humidity_readings`, `pressure_readings`, `particulate_readings`, `node_health`,
`risk_assessments`) should appear in this list. If any are missing, the `create_hypertable(...)`
call for that table likely failed silently — re-run it individually and check for errors.

---

## 2. Seed the Reference/Lookup Tables

Nothing can be inserted into the reading tables until `nodes`, `sensor_types`, and
`node_sensors` are populated, since the reading tables reference them via foreign keys.

```sql
-- Register your nodes (match these to your actual demo/pilot nodes)
INSERT INTO nodes (id, node_type, name, latitude, longitude, deployed_at, status) VALUES
  ('F01', 'forest', 'Forest Node 1', 30.32, 78.03, now(), 'active'),
  ('W01', 'water',  'Water Node 1',  26.14, 91.73, now(), 'active');

-- Register sensor types (repeat for all sensor types you have)
INSERT INTO sensor_types (name, unit, description) VALUES
  ('flame', 'boolean', 'IR flame detection sensor'),
  ('mq135_gas', 'ppm', 'MQ-135 gas sensor'),
  ('soil_moisture', '%', 'Soil moisture sensor'),
  ('ultrasonic_water_level', 'cm', 'JSN-SR04T water level sensor'),
  ('rain_gauge', 'mm', 'DIY tipping-bucket rain gauge'),
  ('turbidity', 'NTU', 'Turbidity sensor'),
  ('bmp280_pressure', 'hPa', 'BMP280 barometric pressure'),
  ('dht22_temp', 'C', 'DHT22 temperature'),
  ('dht22_humidity', '%', 'DHT22 humidity');

-- Map specific sensor instances to specific nodes
INSERT INTO node_sensors (node_id, sensor_type_id, install_date, active) VALUES
  ('F01', (SELECT id FROM sensor_types WHERE name = 'flame'), now(), true),
  ('F01', (SELECT id FROM sensor_types WHERE name = 'mq135_gas'), now(), true),
  ('W01', (SELECT id FROM sensor_types WHERE name = 'ultrasonic_water_level'), now(), true);
  -- continue for every sensor on every node
```

---

## 3. Apply Compression & Retention Policies to Every Table

The schema file only demonstrated this on `water_level_readings` as an example. Repeat the same
pattern for every other sensor table:

```sql
ALTER TABLE gas_readings SET (timescaledb.compress, timescaledb.compress_segmentby = 'node_id');
SELECT add_compression_policy('gas_readings', INTERVAL '7 days');

ALTER TABLE soil_moisture_readings SET (timescaledb.compress, timescaledb.compress_segmentby = 'node_id');
SELECT add_compression_policy('soil_moisture_readings', INTERVAL '7 days');

ALTER TABLE turbidity_readings SET (timescaledb.compress, timescaledb.compress_segmentby = 'node_id');
SELECT add_compression_policy('turbidity_readings', INTERVAL '7 days');

-- Repeat for: rainfall_readings, temperature_readings, humidity_readings,
-- pressure_readings, particulate_readings, node_health, risk_assessments, flame_readings
```

**Note:** consider a longer uncompressed retention window for rare, high-value event tables
(e.g. `flame_readings`) if you want to keep them in an easily-queryable raw state longer for
forensic/incident analysis.

---

## 4. Create Continuous Aggregates for Every Sensor Table

Only `water_level_hourly` was shown as an example. Create the equivalent for every sensor table
your dashboard will chart, so the Node Detail and Historical Analytics pages aren't scanning raw
data on every request:

```sql
CREATE MATERIALIZED VIEW gas_readings_hourly
WITH (timescaledb.continuous) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(gas_ppm) AS avg_gas_ppm, max(gas_ppm) AS max_gas_ppm
FROM gas_readings GROUP BY node_id, bucket;

-- Repeat this pattern for soil_moisture_readings, turbidity_readings,
-- temperature_readings, humidity_readings, pressure_readings, particulate_readings
```

---

## 5. Create a Restricted Database User for the Application

Do not connect from your backend/ingestion code as the database superuser.

```sql
CREATE ROLE ein_app WITH LOGIN PASSWORD 'choose-a-real-password-here';

GRANT SELECT, INSERT ON
  flame_readings, gas_readings, soil_moisture_readings, water_level_readings,
  rainfall_readings, turbidity_readings, temperature_readings, humidity_readings,
  pressure_readings, particulate_readings, node_health, risk_assessments
TO ein_app;

GRANT SELECT ON nodes, sensor_types, node_sensors TO ein_app;
GRANT SELECT, INSERT, UPDATE ON alerts TO ein_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ein_app;
```

---

## 6. Test Inserts — Including a Duplicate-Key Test

Before writing any ingestion code, manually confirm the schema behaves as intended:

```sql
-- Normal insert
INSERT INTO water_level_readings (time, node_id, raw_distance_cm, level_cm, rate_of_rise, source)
VALUES (now(), 'W01', 120.0, 45.5, 0.2, 'real');

-- Duplicate-key test — this should be REJECTED (or upserted, if you choose ON CONFLICT)
INSERT INTO water_level_readings (time, node_id, raw_distance_cm, level_cm, rate_of_rise, source)
VALUES (now(), 'W01', 120.0, 45.5, 0.2, 'real');
```

If you'd rather have retried transmissions silently overwrite instead of failing, use:

```sql
INSERT INTO water_level_readings (...) VALUES (...)
ON CONFLICT (time, node_id) DO UPDATE SET level_cm = EXCLUDED.level_cm;
```

---

## 7. Document Connection Details for the Team

Keep a `.env.example` (not committed with real credentials) so the whole team knows the shape
of what's needed:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ein_db
DB_USER=ein_app
DB_PASSWORD=
```

---

## 8. Mock Data Now, Real Sensor Data Later — The Swap Plan

**Current state:** The mock server (built earlier) generates simulated sensor readings and
serves them directly to the frontend over REST/WebSocket. It does not yet write into this
database — that connection needs to be made.

**Two options for how mock data reaches the database right now:**

### Option A — Backfill script (recommended for immediate demo needs)
Write a one-off script that generates a batch of realistic historical readings (reusing the
mock server's random-walk logic) and inserts them directly via SQL, all marked `source = 'simulated'`.
This gives your dashboard's historical charts something to render immediately, without needing
a live ingestion pipeline running continuously.

### Option B — Live mock ingestion
Point the mock server's existing update loop at the database instead of (or in addition to)
emitting over WebSocket — every simulated reading gets inserted the same way a real sensor's
reading eventually will. This is closer to a full end-to-end test of your real pipeline shape.

Either way, **every simulated row must be written with `source = 'simulated'`** (already a
column in every reading table) so it's clearly distinguishable from real sensor data once real
nodes start reporting into the same tables.

### The actual swap — what changes, and what doesn't

When real sensor nodes are ready to go live:

| What | Changes? | Why |
|---|---|---|
| Database schema | No | Already designed to receive `source = 'real'` rows in the same tables |
| Frontend code | No | Frontend only ever talks to the backend API/WebSocket, never directly to the database or sensors |
| Backend API endpoints | No | Same contract, same response shape, regardless of where the underlying rows came from |
| Data source | **Yes** | Real nodes publish over 4G/MQTT into the backend's ingestion endpoint, using `source = 'real'`, instead of the mock server generating fake rows |
| Old simulated rows | Your choice | Either leave them in the database (clearly marked `source = 'simulated'` so they're filterable out of real analytics), or delete them once real data is flowing: `DELETE FROM water_level_readings WHERE source = 'simulated';` (repeat per table) |

**Recommended practice while both mock and real data might briefly coexist:** any dashboard
query used for real operational decisions (alerts, current risk status) should filter to
`WHERE source = 'real'`. Only your own testing/demo views should ever query `source = 'simulated'`
data, so a stray mock reading can never accidentally trigger a false real-world alert.

---

## Summary Checklist

- [ ] Hypertables verified
- [ ] Reference tables seeded (nodes, sensor_types, node_sensors)
- [ ] Compression policies applied to all tables
- [ ] Continuous aggregates created for all tables
- [ ] Restricted app database user created
- [ ] Test inserts + duplicate-key behavior confirmed
- [ ] Connection details documented for team
- [ ] Mock data strategy decided (backfill script vs. live mock ingestion)
- [ ] `source` column filtering plan agreed for when real and simulated data coexist