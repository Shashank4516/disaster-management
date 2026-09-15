/**
 * Risk engine — evaluates the newest readings of each node against per-node
 * thresholds (node_configs.config, with defaults below) and writes fused
 * risk_assessments rows. When a hazard reaches WARNING/CRITICAL and no active
 * alert exists for that node+hazard, an alert is created (deduplicated).
 *
 * With the `predictive_escalation` node flag enabled, the engine also runs the
 * heuristic forecast and raises the level early (NORMAL → WATCH when a WARNING
 * is predicted within the horizon, anything → WARNING when CRITICAL is
 * predicted), tagging the contributing factors with the prediction.
 */
import { pool } from "./db.js";
import type { Pool, PoolClient } from "pg";
import { confidenceAt, loadHourlyMetric, predictAt } from "./forecast.js";
import { publishAlert } from "./realtime.js";

export const DEFAULT_THRESHOLDS = {
  // Forest
  gas_ppm_warning: 40, // MQ-135 elevated VOCs / smoke
  gas_ppm_critical: 90,
  soil_dry_warning: 25, // moisture % below this = fire fuel drying
  soil_dry_critical: 15,
  // Water
  level_cm_warning: 75, // channel capacity rising
  level_cm_critical: 90,
  rate_of_rise_warning: 5, // cm/hour — flash-flood signature
  rate_of_rise_critical: 12,
  turbidity_ntu_warning: 80,
  turbidity_ntu_critical: 150,
  rainfall_mmph_warning: 10, // sustained intensity
  rainfall_mmph_critical: 30,
  // Shared (both node types)
  temp_c_warning: 38,
  temp_c_critical: 45,
};

export type HazardType = "fire" | "flood" | "air_quality";

interface SensorFacts {
  gas_ppm?: number | null;
  soil_pct?: number | null;
  level_cm?: number | null;
  rate_of_rise?: number | null;
  turbidity_ntu?: number | null;
  rainfall_rate_mmph?: number | null;
  temp_c?: number | null;
}

/** Normalize `undefined` from missing rows/fields to `null`. */
function fact(v: unknown): number | null {
  return (v ?? null) as number | null;
}

type Level = 0 | 1 | 2 | 3;
const WARNING = 2;
const CRITICAL = 3;

function level3(t: { w: number; c: number }, v: number | null | undefined): Level {
  if (v === null || v === undefined) return 0;
  if (v >= t.c) return CRITICAL;
  if (v >= t.w) return WARNING;
  return 0;
}

function level3Low(t: { w: number; c: number }, v: number | null | undefined): Level {
  if (v === null || v === undefined) return 0;
  if (v <= t.c) return CRITICAL;
  if (v <= t.w) return WARNING;
  return 0;
}

/** Score one hazard from individual sensor levels. */
function scoreHazard(sensors: Level[]): { level: Level; confidence: number } {
  const active = sensors.filter((s) => s > 0);
  let level: Level = 0;
  if (active.some((s) => s === CRITICAL) || active.filter((s) => s === WARNING).length >= 2) {
    level = CRITICAL; // one critical signal, or two concurrent warnings
  } else if (active.length > 0) {
    level = WARNING;
  }
  const evidence = sensors.filter((s) => s !== null).length;
  const confidence = evidence === 0 ? 0 : round2(0.5 + 0.5 * (evidence / sensors.length));
  return { level, confidence };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

async function latestFacts(client: PoolClient, nodeId: string): Promise<SensorFacts> {
  const q = async (sql: string): Promise<Record<string, unknown> | undefined> =>
    (await client.query(sql, [nodeId])).rows[0];
  const [gas, soil, water, rain, turb, temp] = await Promise.all([
    q(`SELECT gas_ppm FROM gas_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
    q(`SELECT moisture_pct FROM soil_moisture_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
    q(`SELECT level_cm, rate_of_rise FROM water_level_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
    q(`SELECT rainfall_rate_mmph FROM rainfall_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
    q(`SELECT turbidity_ntu FROM turbidity_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
    q(`SELECT celsius FROM temperature_readings WHERE node_id=$1 ORDER BY time DESC LIMIT 1`),
  ]);
  return {
    gas_ppm: fact(gas?.gas_ppm),
    soil_pct: fact(soil?.moisture_pct),
    level_cm: fact(water?.level_cm),
    rate_of_rise: fact(water?.rate_of_rise),
    turbidity_ntu: fact(turb?.turbidity_ntu),
    rainfall_rate_mmph: fact(rain?.rainfall_rate_mmph),
    temp_c: fact(temp?.celsius),
  };
}

interface Thresholds extends Record<string, number> {}

interface NodeConfig {
  thresholds: Thresholds;
  predictive: boolean;
}

const PREDICTIVE_FLAG = "predictive_escalation";
const FORECAST_HORIZON_HOURS = 6;

export async function getConfig(db: Pool | PoolClient, nodeId: string): Promise<NodeConfig> {
  const { rows } = await db.query<{ config: Record<string, number | boolean> }>(
    `SELECT config FROM node_configs WHERE node_id = $1`,
    [nodeId],
  );
  const raw = rows[0]?.config ?? {};
  const predictive = raw[PREDICTIVE_FLAG] === true;
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const [key, value] of Object.entries(raw)) {
    if (key !== PREDICTIVE_FLAG && typeof value === "number") thresholds[key] = value;
  }
  return { thresholds, predictive };
}

/** Predicted risk level for a forecast metric value against the node thresholds. */
export function forecastLevelFor(metric: string, value: number, t: Thresholds): Level {
  if (metric === "level_cm") return level3({ w: t.level_cm_warning, c: t.level_cm_critical }, value);
  if (metric === "gas_ppm") return level3({ w: t.gas_ppm_warning, c: t.gas_ppm_critical }, value);
  if (metric === "turbidity_ntu") return level3({ w: t.turbidity_ntu_warning, c: t.turbidity_ntu_critical }, value);
  return 0;
}

/**
 * Apply predictive escalation to one assessment: if the trend crosses a higher
 * level within the horizon, lift the current level to WATCH (WARNING predicted)
 * or WARNING (CRITICAL predicted) — never above actual CRITICAL, which only a
 * real threshold crossing produces.
 */
async function applyPredictiveEscalation(
  client: PoolClient,
  nodeId: string,
  nodeType: string,
  a: Assessment,
  t: Thresholds,
): Promise<void> {
  const { metric, fit } = await loadHourlyMetric(client, nodeId, a.hazard_type, nodeType);
  if (!fit) return;
  for (let h = 1; h <= FORECAST_HORIZON_HOURS; h++) {
    const predictedValue = predictAt(fit, h);
    const predictedLevel = forecastLevelFor(metric, predictedValue, t);
    if (predictedLevel > a.risk_level) {
      if (predictedLevel === WARNING) {
        a.risk_level = Math.max(a.risk_level, 1) as Level; // WATCH
      } else if (predictedLevel === CRITICAL) {
        a.risk_level = Math.max(a.risk_level, WARNING) as Level;
      }
      a.confidence = Math.max(a.confidence, confidenceAt(fit, h));
      a.contributing_factors.predicted_metric = metric;
      a.contributing_factors.predicted_value = Math.round(predictedValue * 100) / 100;
      a.contributing_factors.predicted_in_hours = h;
      a.contributing_factors.predicted_level = predictedLevel;
      break;
    }
  }
}

interface Assessment {
  hazard_type: string;
  risk_level: Level;
  confidence: number;
  contributing_factors: Record<string, number | string | null>;
}

export async function assessNode(client: PoolClient, nodeId: string, nodeType: string): Promise<Assessment[]> {
  const { thresholds: t, predictive } = await getConfig(client, nodeId);
  const f = await latestFacts(client, nodeId);
  const out: Assessment[] = [];

  if (nodeType === "forest") {
    const gas = level3({ w: t.gas_ppm_warning, c: t.gas_ppm_critical }, f.gas_ppm);
    const dry = level3Low({ w: t.soil_dry_warning, c: t.soil_dry_critical }, f.soil_pct);
    const hot = level3({ w: t.temp_c_warning, c: t.temp_c_critical }, f.temp_c);
    const fire = scoreHazard([gas, dry, hot]);
    out.push({ hazard_type: "fire", risk_level: fire.level, confidence: fire.confidence, contributing_factors: { gas_ppm: f.gas_ppm ?? null, soil_pct: f.soil_pct ?? null, temp_c: f.temp_c ?? null } });

    const air = scoreHazard([gas]);
    out.push({ hazard_type: "air_quality", risk_level: air.level, confidence: air.confidence, contributing_factors: { gas_ppm: f.gas_ppm ?? null } });
  }

  if (nodeType === "water") {
    const lvl = level3({ w: t.level_cm_warning, c: t.level_cm_critical }, f.level_cm);
    const rise = level3({ w: t.rate_of_rise_warning, c: t.rate_of_rise_critical }, f.rate_of_rise);
    const rain = level3({ w: t.rainfall_mmph_warning, c: t.rainfall_mmph_critical }, f.rainfall_rate_mmph);
    const flood = scoreHazard([lvl, rise, rain]);
    out.push({ hazard_type: "flood", risk_level: flood.level, confidence: flood.confidence, contributing_factors: { level_cm: f.level_cm ?? null, rate_of_rise: f.rate_of_rise ?? null, rainfall_rate_mmph: f.rainfall_rate_mmph ?? null } });

    const turb = level3({ w: t.turbidity_ntu_warning, c: t.turbidity_ntu_critical }, f.turbidity_ntu);
    const air = scoreHazard([turb]);
    out.push({ hazard_type: "air_quality", risk_level: air.level, confidence: air.confidence, contributing_factors: { turbidity_ntu: f.turbidity_ntu ?? null, gas_ppm: f.gas_ppm ?? null } });
  }

  if (predictive) {
    for (const a of out) {
      await applyPredictiveEscalation(client, nodeId, nodeType, a, t);
    }
  }

  return out;
}

const SEVERITY_BY_LEVEL: Record<number, number> = { 2: 2, 3: 3 }; // WARNING→2, CRITICAL→3

const ENGINE_LOCK_ID = 918273645;

/**
 * Evaluate every active node; write assessments; raise deduplicated alerts.
 * Guarded by a session-level advisory lock: the simulator loop, POST
 * /risk/evaluate, and POST /ingest/tick can overlap, and a check-then-insert
 * dedup race would create duplicate alerts. A run that cannot take the lock
 * skips — another evaluation is already in flight, which is equivalent.
 */
export async function runRiskEngine(): Promise<{ assessed: number; alertsCreated: number }> {
  const lock = await pool.connect();
  let locked = false;
  try {
    const { rows } = await lock.query(`SELECT pg_try_advisory_lock(${ENGINE_LOCK_ID}) AS ok`);
    locked = rows[0].ok;
    if (!locked) return { assessed: 0, alertsCreated: 0 };
    return await evaluateAllNodes();
  } finally {
    if (locked) await lock.query(`SELECT pg_advisory_unlock(${ENGINE_LOCK_ID})`).catch(() => {});
    lock.release();
  }
}

async function evaluateAllNodes(): Promise<{ assessed: number; alertsCreated: number }> {
  const { rows: nodes } = await pool.query<{ id: string; node_type: string }>(
    `SELECT id, node_type FROM nodes WHERE status = 'active'`,
  );
  let assessed = 0;
  let alertsCreated = 0;

  for (const node of nodes) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const assessments = await assessNode(client, node.id, node.node_type);
      const now = new Date();
      for (const a of assessments) {
        await client.query(
          `INSERT INTO risk_assessments (time, node_id, hazard_type, risk_level, confidence, contributing_factors, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'simulated')
           ON CONFLICT (time, node_id, hazard_type) DO UPDATE
           SET risk_level = EXCLUDED.risk_level, confidence = EXCLUDED.confidence,
               contributing_factors = EXCLUDED.contributing_factors`,
          [now, node.id, a.hazard_type, a.risk_level, a.confidence, JSON.stringify(a.contributing_factors)],
        );
        assessed += 1;

        if (a.risk_level >= WARNING) {
          const message = `${a.hazard_type} risk level ${a.risk_level} on node ${node.id} (factors: ${Object.entries(a.contributing_factors).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join(", ")})`;
          const { rows } = await client.query<{ id: number }>(
            `INSERT INTO alerts (node_id, hazard_type, severity, message, status)
             SELECT $1, $2, $3, $4, 'active'
             WHERE NOT EXISTS (
               SELECT 1 FROM alerts
               WHERE node_id = $1 AND hazard_type = $2 AND status IN ('active', 'acknowledged')
                 AND triggered_at > now() - INTERVAL '1 hour'
             )
             RETURNING id`,
            [
              node.id,
              a.hazard_type,
              SEVERITY_BY_LEVEL[a.risk_level] ?? a.risk_level,
              message,
            ],
          );
          alertsCreated += rows.length;
          for (const row of rows) {
            await client.query(
              `INSERT INTO alert_events (alert_id, event_type, note) VALUES ($1, 'triggered', $2)`,
              [row.id, `risk level ${a.risk_level}`],
            );
            publishAlert({
              id: row.id,
              node_id: node.id,
              hazard_type: a.hazard_type,
              severity: SEVERITY_BY_LEVEL[a.risk_level] ?? a.risk_level,
              message,
              triggered_at: now.toISOString(),
              status: "active",
            });
          }
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return { assessed, alertsCreated };
}
