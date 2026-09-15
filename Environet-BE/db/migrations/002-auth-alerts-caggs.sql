-- Wave 1: alert event history + continuous aggregates for history queries.
-- Idempotent — safe to re-run.

-- Full lifecycle trail for alerts (triggered/acknowledged/resolved/escalated).
CREATE TABLE IF NOT EXISTS alert_events (
  id            SERIAL PRIMARY KEY,
  alert_id      INT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,          -- 'triggered' | 'acknowledged' | 'resolved' | 'escalated'
  note          TEXT,
  actor_user_id INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_alert ON alert_events (alert_id, created_at);

-- ------------------------------------------------------------------
-- Hourly continuous aggregates, one per chartable sensor table.
-- Real-time mode (materialized_only = false) so the current partial
-- hour is included; refreshed every 30 minutes.
-- ------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS gas_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(gas_ppm) AS avg_gas_ppm, max(gas_ppm) AS max_gas_ppm,
       count(*) AS samples
FROM gas_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS soil_moisture_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(moisture_pct) AS avg_moisture_pct, max(moisture_pct) AS max_moisture_pct,
       count(*) AS samples
FROM soil_moisture_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS turbidity_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(turbidity_ntu) AS avg_turbidity_ntu, max(turbidity_ntu) AS max_turbidity_ntu,
       count(*) AS samples
FROM turbidity_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS temperature_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(celsius) AS avg_celsius, max(celsius) AS max_celsius,
       count(*) AS samples
FROM temperature_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS humidity_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(relative_humidity_pct) AS avg_relative_humidity_pct,
       max(relative_humidity_pct) AS max_relative_humidity_pct,
       count(*) AS samples
FROM humidity_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS pressure_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       avg(pressure_hpa) AS avg_pressure_hpa, max(pressure_hpa) AS max_pressure_hpa,
       count(*) AS samples
FROM pressure_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS rainfall_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       sum(tip_count) AS tip_count, sum(rainfall_mm) AS rainfall_mm,
       max(rainfall_rate_mmph) AS max_rainfall_rate_mmph,
       count(*) AS samples
FROM rainfall_readings GROUP BY node_id, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS flame_readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT node_id, time_bucket('1 hour', time) AS bucket,
       bool_or(detected) AS any_detection,
       sum(CASE WHEN detected THEN 1 ELSE 0 END) AS detection_count,
       count(*) AS samples
FROM flame_readings GROUP BY node_id, bucket;

-- The schema's original example cagg predates real-time mode — upgrade it.
ALTER MATERIALIZED VIEW water_level_hourly SET (timescaledb.materialized_only = false);

-- Refresh policies (guarded so re-running never duplicates jobs).
DO $$
DECLARE
  agg TEXT;
BEGIN
  FOREACH agg IN ARRAY ARRAY[
    'gas_readings_hourly', 'soil_moisture_readings_hourly', 'turbidity_readings_hourly',
    'temperature_readings_hourly', 'humidity_readings_hourly', 'pressure_readings_hourly',
    'rainfall_readings_hourly', 'flame_readings_hourly', 'water_level_hourly'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_refresh_continuous_aggregate' AND hypertable_name = agg
    ) THEN
      PERFORM add_continuous_aggregate_policy(
        agg,
        start_offset    => INTERVAL '7 days',
        end_offset      => INTERVAL '1 hour',
        schedule_interval => INTERVAL '30 minutes'
      );
    END IF;
  END LOOP;
END $$;
