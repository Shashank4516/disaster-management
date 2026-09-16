/**
 * Sensor catalog — registry rows from sensor_types / node_sensors plus the
 * newest reading for each mounted instance. Powers the dashboard Raw Sensors page.
 */
import type { Request, Response } from "express";
import type { Pool } from "pg";

const LATEST_BY_TYPE = `
  SELECT 'flame'::text AS sensor_type, node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source' AS values
  FROM (SELECT DISTINCT ON (node_id) * FROM flame_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'mq135_gas', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM gas_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'soil_moisture', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM soil_moisture_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'ultrasonic_water_level', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM water_level_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'rain_gauge', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM rainfall_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'turbidity', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM turbidity_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'bmp280_pressure', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM pressure_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'dht22_temp', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM temperature_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'dht22_humidity', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM humidity_readings ORDER BY node_id, time DESC) t
  UNION ALL
  SELECT 'particulate', node_id, time, quality_flag, source, sensor_instance_id,
         to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
  FROM (SELECT DISTINCT ON (node_id) * FROM particulate_readings ORDER BY node_id, time DESC) t
`;

export interface SensorRoutesDeps {
  pool: Pool;
}

export function registerSensorRoutes(app: import("express").Express, deps: SensorRoutesDeps): void {
  const { pool } = deps;

  // GET /api/sensors — mounted instances + latest raw sample
  app.get("/api/sensors", async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           ns.id AS instance_id,
           ns.node_id,
           n.name AS node_name,
           n.node_type,
           n.status AS node_status,
           st.name AS sensor_type,
           st.unit,
           st.description,
           ns.active,
           ns.calibration_offset,
           ns.calibrated_at,
           ns.install_date,
           l.time AS last_seen,
           l.values,
           l.quality_flag,
           l.source
         FROM node_sensors ns
         JOIN nodes n ON n.id = ns.node_id
         JOIN sensor_types st ON st.id = ns.sensor_type_id
         LEFT JOIN (${LATEST_BY_TYPE}) l
           ON l.node_id = ns.node_id AND l.sensor_type = st.name
         WHERE ns.active = true
           AND st.name NOT IN ('flame', 'soil_moisture')
         ORDER BY ns.node_id, st.name`,
      );
      res.status(200).json({
        count: rows.length,
        sensors: rows.map((row) => ({
          instance_id: row.instance_id,
          node_id: row.node_id,
          node_name: row.node_name,
          node_type: row.node_type,
          node_status: row.node_status,
          sensor_type: row.sensor_type,
          unit: row.unit,
          description: row.description,
          active: row.active,
          calibration_offset: row.calibration_offset,
          calibrated_at: row.calibrated_at,
          install_date: row.install_date,
          last_seen: row.last_seen,
          quality_flag: row.quality_flag,
          source: row.source,
          values: row.values || {},
        })),
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
