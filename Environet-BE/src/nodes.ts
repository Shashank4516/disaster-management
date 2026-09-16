/**
 * Node endpoints (ENDPOINTS.md §1 + §5): per-node detail, time-series history,
 * threshold config (the feedback loop), and node registration with API keys.
 */
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { DEFAULT_THRESHOLDS } from "./riskEngine.js";

interface HistorySensor {
  table: string;      // raw table
  cagg: string;       // hourly continuous aggregate
  rawCols: string[];  // value columns selected from raw table
  caggCols: string;   // column list selected from the cagg
}

export const SENSORS: Record<string, HistorySensor> = {
  flame: {
    table: "flame_readings",
    cagg: "flame_readings_hourly",
    rawCols: ["detected", "raw_value"],
    caggCols: "any_detection, detection_count, samples",
  },
  mq135_gas: {
    table: "gas_readings",
    cagg: "gas_readings_hourly",
    rawCols: ["gas_ppm", "gas_deviation"],
    caggCols: "avg_gas_ppm, max_gas_ppm, samples",
  },
  soil_moisture: {
    table: "soil_moisture_readings",
    cagg: "soil_moisture_readings_hourly",
    rawCols: ["moisture_pct", "moisture_trend"],
    caggCols: "avg_moisture_pct, max_moisture_pct, samples",
  },
  ultrasonic_water_level: {
    table: "water_level_readings",
    cagg: "water_level_hourly",
    rawCols: ["level_cm", "rate_of_rise"],
    caggCols: "avg_level_cm, max_level_cm, avg_rate_of_rise",
  },
  rain_gauge: {
    table: "rainfall_readings",
    cagg: "rainfall_readings_hourly",
    rawCols: ["rainfall_mm", "rainfall_rate_mmph"],
    caggCols: "tip_count, rainfall_mm, max_rainfall_rate_mmph, samples",
  },
  turbidity: {
    table: "turbidity_readings",
    cagg: "turbidity_readings_hourly",
    rawCols: ["turbidity_ntu", "turbidity_deviation"],
    caggCols: "avg_turbidity_ntu, max_turbidity_ntu, samples",
  },
  bmp280_pressure: {
    table: "pressure_readings",
    cagg: "pressure_readings_hourly",
    rawCols: ["pressure_hpa", "pressure_trend"],
    caggCols: "avg_pressure_hpa, max_pressure_hpa, samples",
  },
  dht22_temp: {
    table: "temperature_readings",
    cagg: "temperature_readings_hourly",
    rawCols: ["celsius"],
    caggCols: "avg_celsius, max_celsius, samples",
  },
  dht22_humidity: {
    table: "humidity_readings",
    cagg: "humidity_readings_hourly",
    rawCols: ["relative_humidity_pct"],
    caggCols: "avg_relative_humidity_pct, max_relative_humidity_pct, samples",
  },
};

// range → { raw bucket width, or 'cagg' to use the hourly aggregates }
const RANGES: Record<string, string> = {
  "1h": "1 minute",
  "6h": "5 minutes",
  "24h": "15 minutes",
  "7d": "cagg",
  "30d": "cagg",
};

const LATEST_READINGS_QUERY = `
  SELECT * FROM (
    SELECT 'flame' AS sensor_type, time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source' AS values
    FROM flame_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'mq135_gas', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM gas_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'soil_moisture', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM soil_moisture_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'ultrasonic_water_level', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM water_level_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'rain_gauge', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM rainfall_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'turbidity', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM turbidity_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'bmp280_pressure', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM pressure_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'dht22_temp', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM temperature_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q UNION ALL SELECT * FROM (
    SELECT 'dht22_humidity', time, quality_flag, source, sensor_instance_id,
           to_jsonb(t) - 'time' - 'node_id' - 'sensor_instance_id' - 'quality_flag' - 'source'
    FROM humidity_readings t WHERE node_id = $1 ORDER BY time DESC LIMIT 1
  ) q`;

export interface NodeRoutesDeps {
  pool: Pool;
}

export function registerNodeRoutes(app: import("express").Express, deps: NodeRoutesDeps): void {
  const { pool } = deps;

  // GET /api/nodes/:id — metadata, config, risks, health, latest reading per sensor
  app.get("/api/nodes/:id", async (req: Request, res: Response) => {
    try {
      const { rows: nodeRows } = await pool.query(
        `SELECT id, node_type, name, latitude, longitude, status, deployed_at, api_key IS NOT NULL AS has_api_key
         FROM nodes WHERE id = $1`,
        [req.params.id],
      );
      if (!nodeRows[0]) {
        res.status(404).json({ error: "node not found" });
        return;
      }

      const [risks, health, readings, config] = await Promise.all([
        pool.query(
          `SELECT DISTINCT ON (hazard_type) hazard_type, risk_level, confidence, time AS assessed_at
           FROM risk_assessments WHERE node_id = $1 ORDER BY hazard_type, time DESC`,
          [req.params.id],
        ),
        pool.query(
          `SELECT battery_pct, battery_voltage, signal_dbm, online, uptime_seconds, time
           FROM node_health WHERE node_id = $1 ORDER BY time DESC LIMIT 1`,
          [req.params.id],
        ),
        pool.query(LATEST_READINGS_QUERY, [req.params.id]),
        pool.query(`SELECT config, updated_at FROM node_configs WHERE node_id = $1`, [req.params.id]),
      ]);

      res.status(200).json({
        node: nodeRows[0],
        config: config.rows[0] ?? null,
        risks: risks.rows,
        health: health.rows[0] ?? null,
        latest_readings: readings.rows.map((r) => ({
          sensor_type: r.sensor_type,
          time: r.time,
          quality_flag: r.quality_flag,
          source: r.source,
          sensor_instance_id: r.sensor_instance_id,
          values: r.values,
        })),
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/nodes/:id/history?sensor=ultrasonic_water_level&range=24h
  app.get("/api/nodes/:id/history", async (req: Request, res: Response) => {
    const sensor = SENSORS[req.query.sensor as string];
    if (!sensor) {
      res.status(400).json({ error: `unknown sensor "${req.query.sensor}"`, valid: Object.keys(SENSORS) });
      return;
    }
    const range = RANGES[req.query.range as string];
    if (!range) {
      res.status(400).json({ error: `unknown range "${req.query.range}"`, valid: Object.keys(RANGES) });
      return;
    }

    const nodeCheck = await pool.query(`SELECT 1 FROM nodes WHERE id = $1`, [req.params.id]);
    if (!nodeCheck.rowCount) {
      res.status(404).json({ error: "node not found" });
      return;
    }

    try {
      const cols = sensor.rawCols.map((c) => `avg(${c}) AS ${c}`).join(", ");
      let query: string;
      let params: unknown[];
      if (range === "cagg") {
        // Long ranges: pre-aggregated hourly buckets from the continuous aggregate.
        query = `SELECT bucket AS time, ${sensor.caggCols}
                 FROM ${sensor.cagg}
                 WHERE node_id = $1 AND bucket >= now() - $2::interval
                 ORDER BY bucket`;
        params = [req.params.id, `${req.query.range}`.replace("d", " days")];
      } else {
        // Short ranges: bucket raw rows on the fly (small volume, fully real-time).
        query = `SELECT time_bucket($3::interval, time) AS bucket, ${cols}, count(*) AS samples
                 FROM ${sensor.table}
                 WHERE node_id = $1 AND time >= now() - $2::interval
                 GROUP BY bucket ORDER BY bucket`;
        params = [req.params.id, `${req.query.range}`.replace("h", " hours"), range];
      }
      const { rows } = await pool.query(query, params);
      res.status(200).json({
        node_id: req.params.id,
        sensor: req.query.sensor,
        range: req.query.range,
        bucket_source: range === "cagg" ? "hourly_continuous_aggregate" : "raw",
        points: rows,
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ------------------------------------------------------------------
  // Threshold configuration (auth required) — ENDPOINTS.md §5
  // ------------------------------------------------------------------

  // GET /api/nodes/:id/config — defaults, stored overrides, effective values
  app.get("/api/nodes/:id/config", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT config, updated_at FROM node_configs WHERE node_id = $1`,
        [req.params.id],
      );
      const node = await pool.query(`SELECT 1 FROM nodes WHERE id = $1`, [req.params.id]);
      if (!node.rowCount) {
        res.status(404).json({ error: "node not found" });
        return;
      }
      const overrides = (rows[0]?.config ?? {}) as Record<string, number>;
      res.status(200).json({
        node_id: req.params.id,
        defaults: DEFAULT_THRESHOLDS,
        overrides,
        effective: { ...DEFAULT_THRESHOLDS, ...overrides },
        updated_at: rows[0]?.updated_at ?? null,
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PUT /api/nodes/:id/config { threshold: value, ... } — upsert overrides.
  // Keys unknown to the engine are rejected so typos fail loudly.
  app.put("/api/nodes/:id/config", requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ error: "body must be a JSON object of { threshold: number }" });
      return;
    }
    const validKeys = Object.keys(DEFAULT_THRESHOLDS);
    const overrides: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "predictive_escalation") {
        // Non-threshold engine flag: toggles predictive escalation (Phase 2).
        if (typeof value !== "boolean") {
          res.status(400).json({ error: 'threshold "predictive_escalation" must be a boolean' });
          return;
        }
        overrides[key] = value;
        continue;
      }
      if (!validKeys.includes(key)) {
        res.status(400).json({ error: `unknown threshold "${key}"`, valid: [...validKeys, "predictive_escalation"] });
        return;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        res.status(400).json({ error: `threshold "${key}" must be a finite number` });
        return;
      }
      overrides[key] = value;
    }
    try {
      const node = await pool.query(`SELECT 1 FROM nodes WHERE id = $1`, [req.params.id]);
      if (!node.rowCount) {
        res.status(404).json({ error: "node not found" });
        return;
      }
      // Merge with existing overrides so a PUT only replaces the sent keys.
      const existing = await pool.query<{ config: Record<string, number> }>(
        `SELECT config FROM node_configs WHERE node_id = $1`,
        [req.params.id],
      );
      const merged = { ...(existing.rows[0]?.config ?? {}), ...overrides };
      const { rows } = await pool.query(
        `INSERT INTO node_configs (node_id, config, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (node_id) DO UPDATE SET config = $2, updated_at = now()
         RETURNING config, updated_at`,
        [req.params.id, JSON.stringify(merged)],
      );
      res.status(200).json({
        node_id: req.params.id,
        overrides: rows[0].config,
        effective: { ...DEFAULT_THRESHOLDS, ...rows[0].config },
        updated_at: rows[0].updated_at,
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ------------------------------------------------------------------
  // Node registration (auth required) — ENDPOINTS.md §5
  // ------------------------------------------------------------------

  // POST /api/nodes { id, node_type, name?, latitude?, longitude? }
  // The generated api_key is shown once in this response.
  app.post("/api/nodes", requireAuth, async (req: Request, res: Response) => {
    const { id, node_type, name, latitude, longitude } = req.body ?? {};
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{2,16}$/.test(id)) {
      res.status(400).json({ error: "id must be 2-16 chars (letters, digits, _ -)" });
      return;
    }
    if (node_type !== "forest" && node_type !== "water" && node_type !== "atmosphere") {
      res.status(400).json({ error: "node_type must be forest, water, or atmosphere" });
      return;
    }
    if (latitude !== undefined && (typeof latitude !== "number" || latitude < -90 || latitude > 90)) {
      res.status(400).json({ error: "latitude must be a number between -90 and 90" });
      return;
    }
    if (longitude !== undefined && (typeof longitude !== "number" || longitude < -180 || longitude > 180)) {
      res.status(400).json({ error: "longitude must be a number between -180 and 180" });
      return;
    }
    try {
      const apiKey = randomBytes(24).toString("hex");
      const { rows } = await pool.query(
        `INSERT INTO nodes (id, node_type, name, latitude, longitude, deployed_at, status, api_key)
         VALUES ($1, $2, $3, $4, $5, now(), 'active', $6)
         RETURNING id, node_type, name, latitude, longitude, status, deployed_at`,
        [id, node_type, name ?? null, latitude ?? null, longitude ?? null, apiKey],
      );
      res.status(201).json({
        node: rows[0],
        api_key: apiKey,
        note: "Store this API key now — nodes authenticate to the ingestion path with it, and it is not returned by read endpoints.",
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("nodes_pkey")) {
        res.status(409).json({ error: `node id "${id}" already exists` });
        return;
      }
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
