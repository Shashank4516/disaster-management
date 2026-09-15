-- Wave 4 housekeeping: TimescaleDB compression + retention across all
-- hypertables (idempotent — guarded so re-running never duplicates jobs).

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'flame_readings', 'gas_readings', 'soil_moisture_readings',
    'water_level_readings', 'rainfall_readings', 'turbidity_readings',
    'temperature_readings', 'humidity_readings', 'pressure_readings',
    'particulate_readings', 'node_health', 'risk_assessments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_compression' AND hypertable_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I SET (timescaledb.compress, timescaledb.compress_segmentby = %L)', t, 'node_id');
      PERFORM add_compression_policy(t, INTERVAL '7 days');
    END IF;
  END LOOP;

  -- Derived data: the risk engine re-assesses every cycle, so history beyond
  -- 30 days has no analytical value. Raw readings are kept (compressed).
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_retention' AND hypertable_name = 'risk_assessments'
  ) THEN
    PERFORM add_retention_policy('risk_assessments', INTERVAL '30 days');
  END IF;
END $$;
