-- ============================================================
-- Environmental Intelligence Network — Database Schema
-- TimescaleDB (PostgreSQL) — organized per SENSOR TYPE, not per node type
-- ============================================================

-- Ensure the extension exists before any create_hypertable call. This makes
-- the schema self-sufficient on a freshly created database (CI snapshot job)
-- where the image's init scripts may not have installed it yet.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ------------------------------------------------------------
-- 1. CORE REGISTRY TABLES (not hypertables — small, slow-changing)
-- ------------------------------------------------------------

CREATE TABLE nodes (
  id            TEXT PRIMARY KEY,               -- e.g. 'F01', 'W01'
  node_type     TEXT NOT NULL,                  -- 'forest' | 'water' | 'atmosphere'
  name          TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  deployed_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'maintenance' | 'decommissioned'
);

CREATE TABLE sensor_types (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,           -- 'flame','mq135_gas','soil_moisture', etc.
  unit          TEXT,                           -- 'ppm','%','cm','NTU','hPa', etc.
  description   TEXT
);

-- Tracks a PHYSICAL sensor instance mounted on a node.
-- Needed so recalibration or sensor replacement doesn't corrupt history —
-- old readings stay tied to the old calibration/instance record.
CREATE TABLE node_sensors (
  id                  SERIAL PRIMARY KEY,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_type_id      INT NOT NULL REFERENCES sensor_types(id),
  install_date        TIMESTAMPTZ DEFAULT now(),
  calibration_offset  REAL DEFAULT 0, 
  calibrated_at       TIMESTAMPTZ,
  active              BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'authority',
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. PER-SENSOR HYPERTABLES (Forest Node sensors)
-- ------------------------------------------------------------

CREATE TABLE flame_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  detected            BOOLEAN NOT NULL, -- NO
  raw_value           REAL,               -- raw analog intensity, if available
  quality_flag        SMALLINT NOT NULL DEFAULT 1,   -- 1=valid, 0=suspect, -1=fault
  source              TEXT NOT NULL DEFAULT 'real',  -- 'real' | 'simulated'
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('flame_readings', 'time');
CREATE INDEX ON flame_readings (node_id, time DESC);

CREATE TABLE gas_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  raw_voltage         REAL,
  gas_ppm             REAL,
  gas_deviation       REAL,               -- deviation from rolling baseline
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('gas_readings', 'time');
CREATE INDEX ON gas_readings (node_id, time DESC);

CREATE TABLE soil_moisture_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  raw_value           REAL,
  moisture_pct        REAL,
  moisture_trend      REAL,               -- multi-day dryness trend
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('soil_moisture_readings', 'time');
CREATE INDEX ON soil_moisture_readings (node_id, time DESC);

-- ------------------------------------------------------------
-- 3. PER-SENSOR HYPERTABLES (Water Node sensors)
-- ------------------------------------------------------------

CREATE TABLE water_level_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  raw_distance_cm     REAL,               -- raw ultrasonic distance to surface
  level_cm            REAL,               -- converted: mount_height - raw_distance
  rate_of_rise        REAL,               -- cm/hour
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('water_level_readings', 'time');
CREATE INDEX ON water_level_readings (node_id, time DESC);

CREATE TABLE rainfall_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  tip_count           INT,
  rainfall_mm         REAL,
  rainfall_rate_mmph  REAL,
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('rainfall_readings', 'time');
CREATE INDEX ON rainfall_readings (node_id, time DESC);

CREATE TABLE turbidity_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  raw_voltage         REAL,
  turbidity_ntu       REAL,
  turbidity_deviation REAL,
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('turbidity_readings', 'time');
CREATE INDEX ON turbidity_readings (node_id, time DESC);

CREATE TABLE temperature_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  celsius             REAL,
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('temperature_readings', 'time');
CREATE INDEX ON temperature_readings (node_id, time DESC);

CREATE TABLE humidity_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  relative_humidity_pct REAL,
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('humidity_readings', 'time');
CREATE INDEX ON humidity_readings (node_id, time DESC);

CREATE TABLE pressure_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  pressure_hpa        REAL,
  pressure_trend      REAL,               -- change over past 3-6h
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('pressure_readings', 'time');
CREATE INDEX ON pressure_readings (node_id, time DESC);

-- ------------------------------------------------------------
-- 4. PER-SENSOR HYPERTABLES (Atmosphere Node — future, other sub-team)
-- Included now so the schema is ready before that node exists.
-- ------------------------------------------------------------

CREATE TABLE particulate_readings (
  time                TIMESTAMPTZ NOT NULL,
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  sensor_instance_id  INT REFERENCES node_sensors(id),
  pm2_5_ugm3          REAL,
  pm10_ugm3           REAL,
  aqi_equivalent      REAL,               -- converted to CPCB-style AQI scale
  quality_flag        SMALLINT NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('particulate_readings', 'time');
CREATE INDEX ON particulate_readings (node_id, time DESC);

-- ------------------------------------------------------------
-- 5. NODE HEALTH (operational telemetry, not environmental data)
-- ------------------------------------------------------------

CREATE TABLE node_health (
  time            TIMESTAMPTZ NOT NULL,
  node_id         TEXT NOT NULL REFERENCES nodes(id),
  battery_pct     REAL,
  battery_voltage REAL,
  signal_dbm      SMALLINT,
  online          BOOLEAN NOT NULL,
  uptime_seconds  INT,
  PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('node_health', 'time');
CREATE INDEX ON node_health (node_id, time DESC);

-- ------------------------------------------------------------
-- 6. FUSED RISK OUTPUT (combines multiple sensors — not tied to just one)
-- ------------------------------------------------------------

CREATE TABLE risk_assessments (
  time                  TIMESTAMPTZ NOT NULL,
  node_id               TEXT NOT NULL REFERENCES nodes(id),
  hazard_type           TEXT NOT NULL,     -- 'fire','flood','air_quality','landslide'
  risk_level            SMALLINT NOT NULL, -- 0=NORMAL,1=WATCH,2=WARNING,3=CRITICAL
  confidence            REAL,
  contributing_factors  JSONB,             -- e.g. {"gas_deviation":25,"soil_trend":-3}
  source                TEXT NOT NULL DEFAULT 'real',
  PRIMARY KEY (time, node_id, hazard_type)
);
SELECT create_hypertable('risk_assessments', 'time');
CREATE INDEX ON risk_assessments (node_id, time DESC);

-- ------------------------------------------------------------
-- 7. ALERTS (operational table, not a hypertable — low volume, needs updates)
-- ------------------------------------------------------------

CREATE TABLE alerts (
  id               SERIAL PRIMARY KEY,
  node_id          TEXT NOT NULL REFERENCES nodes(id),
  hazard_type      TEXT NOT NULL,
  severity         SMALLINT NOT NULL,
  message          TEXT,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active', -- 'active'|'acknowledged'|'resolved'
  acknowledged_by  INT REFERENCES users(id),
  acknowledged_at  TIMESTAMPTZ
);
CREATE INDEX ON alerts (node_id, triggered_at DESC);
CREATE INDEX ON alerts (status);

-- ============================================================
-- 8. RETENTION / COMPRESSION POLICIES (examples — repeat per table)
-- ============================================================

-- Compress raw data older than 7 days (near-zero effort, big storage win)
ALTER TABLE water_level_readings SET (timescaledb.compress, timescaledb.compress_segmentby = 'node_id');
SELECT add_compression_policy('water_level_readings', INTERVAL '7 days');

-- Repeat the above two statements for each sensor table, adjusting the
-- table name. Consider shorter retention/compression windows for
-- high-value rare-event tables (e.g. flame_readings) if you want to keep
-- them uncompressed/raw longer for forensic analysis.

-- Example: drop raw chunks older than 90 days (after archiving elsewhere)
-- SELECT drop_chunks('water_level_readings', older_than => INTERVAL '90 days');

-- ============================================================
-- 9. EXAMPLE CONTINUOUS AGGREGATE (precomputed hourly rollup for charts)
-- ============================================================

CREATE MATERIALIZED VIEW water_level_hourly
WITH (timescaledb.continuous) AS
SELECT node_id,
       time_bucket('1 hour', time) AS bucket,
       avg(level_cm)   AS avg_level_cm,
       max(level_cm)   AS max_level_cm,
       avg(rate_of_rise) AS avg_rate_of_rise
FROM water_level_readings
GROUP BY node_id, bucket;

-- Repeat this pattern for other sensor tables as your dashboard needs
-- historical trend charts for them.