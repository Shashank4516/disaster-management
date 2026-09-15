/**
 * Live mock ingestion — generates realistic sensor readings and writes them
 * through the same insert path real sensors will use later.
 *
 * Every row is written with source = 'simulated'. When real nodes go live they
 * publish into the same tables with source = 'real'; nothing else changes
 * (NEXT_STEPS.md §8). Operational queries should filter WHERE source = 'real'.
 */
import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { runRiskEngine } from "./riskEngine.js";
import { publishNodeStatus, publishReading } from "./realtime.js";

const TICK_MS = 5000;

// Small quality-of-service helpers -------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Random walk with mean reversion toward a baseline. */
function walk(current: number, baseline: number, volatility: number, floor: number, ceiling: number): number {
  const pulled = (baseline - current) * 0.05;
  const next = current + pulled + (Math.random() - 0.5) * 2 * volatility;
  return clamp(next, floor, ceiling);
}

/** ~1 in 50 readings is suspect (quality_flag 0); faults are not simulated. */
function qualityFlag(): number {
  return Math.random() < 0.02 ? 0 : 1;
}

// Sensor state per node -------------------------------------------------------

interface NodeSimState {
  gasPpm: number;
  soilPct: number;
  tempC: number;
  humidityPct: number;
  pressureHpa: number;
  levelCm: number;
  turbidityNtu: number;
  rainWindowTips: number;
  rainWindowStartMs: number;
  rainActive: boolean;
  rainRemainingMin: number;
  // Node health telemetry
  batteryPct: number;
  signalDbm: number;
  online: boolean;
  outageTicksLeft: number;
  uptimeSeconds: number;
}

function freshState(): NodeSimState {
  return {
    gasPpm: 12,
    soilPct: 48,
    tempC: 24,
    humidityPct: 62,
    pressureHpa: 1013,
    levelCm: 45,
    turbidityNtu: 4,
    rainWindowTips: 0,
    rainWindowStartMs: Date.now(),
    rainActive: false,
    rainRemainingMin: 0,
    batteryPct: 90 + Math.random() * 8,
    signalDbm: -60 - Math.random() * 15,
    online: true,
    outageTicksLeft: 0,
    uptimeSeconds: Math.floor(Math.random() * 7 * 24 * 3600),
  };
}

const states = new Map<string, NodeSimState>();

function stateFor(nodeId: string): NodeSimState {
  let s = states.get(nodeId);
  if (!s) {
    s = freshState();
    states.set(nodeId, s);
  }
  return s;
}

// Diurnal cycle: peaks around 14:00 local -------------------------------

function diurnal(hour: number): number {
  return Math.sin(((hour - 8) / 24) * 2 * Math.PI);
}

// Row builders per sensor type -----------------------------------------------

interface Reading {
  table: string;
  values: unknown[];
  /** SET clause for the upsert; omit for tables without a `source` column (node_health). */
  conflictUpdate?: string;
}

/** Per-table realtime metadata: registry sensor name + value column order
 *  (values arrays are [time, node_id, sensor_instance_id, ...cols, quality_flag, source]). */
const READING_META: Record<string, { sensor: string; valueColumns: string[] }> = {
  flame_readings: { sensor: "flame", valueColumns: ["detected", "raw_value"] },
  gas_readings: { sensor: "mq135_gas", valueColumns: ["raw_voltage", "gas_ppm", "gas_deviation"] },
  soil_moisture_readings: { sensor: "soil_moisture", valueColumns: ["raw_value", "moisture_pct", "moisture_trend"] },
  water_level_readings: { sensor: "ultrasonic_water_level", valueColumns: ["raw_distance_cm", "level_cm", "rate_of_rise"] },
  rainfall_readings: { sensor: "rain_gauge", valueColumns: ["tip_count", "rainfall_mm", "rainfall_rate_mmph"] },
  turbidity_readings: { sensor: "turbidity", valueColumns: ["raw_voltage", "turbidity_ntu", "turbidity_deviation"] },
  temperature_readings: { sensor: "dht22_temp", valueColumns: ["celsius"] },
  humidity_readings: { sensor: "dht22_humidity", valueColumns: ["relative_humidity_pct"] },
  pressure_readings: { sensor: "bmp280_pressure", valueColumns: ["pressure_hpa", "pressure_trend"] },
};

const INSTANCE_CACHE = new Map<string, number>();

async function sensorInstanceId(
  client: PoolClient,
  nodeId: string,
  sensorType: string,
): Promise<number | null> {
  const key = `${nodeId}:${sensorType}`;
  let id = INSTANCE_CACHE.get(key);
  if (id === undefined) {
    const { rows } = await client.query<{ id: number }>(
      `SELECT ns.id FROM node_sensors ns
       JOIN sensor_types st ON st.id = ns.sensor_type_id
       WHERE ns.node_id = $1 AND st.name = $2 AND ns.active
       ORDER BY ns.id LIMIT 1`,
      [nodeId, sensorType],
    );
    id = rows[0]?.id ?? null;
    if (id !== null) INSTANCE_CACHE.set(key, id);
  }
  return id;
}

type Builder = (nodeId: string, now: Date, client: PoolClient) => Promise<Reading | null>;

const builders: Record<string, Builder[]> = {
  forest: [
    // Flame detector: almost always no detection; rare blips.
    async (nodeId, now, client) => {
      const detected = Math.random() < 0.005;
      return {
        table: "flame_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "flame"), detected, detected ? 900 : round(30 + Math.random() * 20, 1), qualityFlag(), "simulated"],
      };
    },
    // MQ-135 gas: baseline ~12 ppm, spikes occasionally.
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      const spike = Math.random() < 0.01 ? 20 + Math.random() * 30 : 0;
      s.gasPpm = walk(s.gasPpm + spike, 12, 0.8, 2, 120);
      const deviation = round(s.gasPpm - 12, 2);
      return {
        table: "gas_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "mq135_gas"), round(0.4 + s.gasPpm * 0.02, 3), round(s.gasPpm, 2), deviation, qualityFlag(), "simulated"],
      };
    },
    // Soil moisture: dries slowly during the day, recharged by "rain".
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      s.soilPct = walk(s.soilPct - 0.01, 48, 0.15, 15, 70);
      const trend = round(-0.4 + diurnal(now.getHours()) * 0.2, 2);
      return {
        table: "soil_moisture_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "soil_moisture"), round(s.soilPct * 30, 1), round(s.soilPct, 2), trend, qualityFlag(), "simulated"],
      };
    },
  ],
  water: [
    // Water level: slow random walk in the channel.
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      const rainBoost = s.rainActive ? 0.05 : 0;
      s.levelCm = walk(s.levelCm + rainBoost, 45, 0.3, 10, 95);
      return {
        table: "water_level_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "ultrasonic_water_level"), round(120 - s.levelCm, 1), round(s.levelCm, 2), round(rainBoost * 60, 2), qualityFlag(), "simulated"],
      };
    },
    // Rain gauge: brief rain episodes produce tips; dry otherwise.
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      if (!s.rainActive && Math.random() < 0.005) {
        s.rainActive = true;
        s.rainRemainingMin = 5 + randomInt(0, 20);
      }
      if (s.rainActive && Date.now() - s.rainWindowStartMs >= 60_000) {
        s.rainWindowStartMs = Date.now();
        s.rainRemainingMin -= 1;
        if (s.rainRemainingMin <= 0) s.rainActive = false;
      }
      const tips = s.rainActive ? randomInt(0, 8) : Math.random() < 0.002 ? 1 : 0;
      s.rainWindowTips += tips;
      const mm = round(tips * 0.25, 2);
      return {
        table: "rainfall_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "rain_gauge"), tips, mm, round(tips * 0.25 * 12, 2), qualityFlag(), "simulated"],
      };
    },
    // Turbidity: rises during rain episodes (runoff).
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      const target = s.rainActive ? 60 : 4;
      s.turbidityNtu = walk(s.turbidityNtu, target, s.rainActive ? 6 : 0.5, 0.5, 200);
      return {
        table: "turbidity_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "turbidity"), round(0.2 + s.turbidityNtu * 0.01, 3), round(s.turbidityNtu, 2), round(s.turbidityNtu - 4, 2), qualityFlag(), "simulated"],
      };
    },
  ],
};

// Both node types carry the atmosphere trio.
for (const nodeType of Object.keys(builders)) {
  builders[nodeType].push(
    // DHT22 temperature
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      s.tempC = walk(s.tempC + diurnal(now.getHours()) * 0.05, 24, 0.1, 5, 45);
      return {
        table: "temperature_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "dht22_temp"), round(s.tempC, 2), qualityFlag(), "simulated"],
      };
    },
    // DHT22 humidity (inverse of temperature-ish)
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      s.humidityPct = walk(s.humidityPct - diurnal(now.getHours()) * 0.05, 62, 0.3, 20, 98);
      return {
        table: "humidity_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "dht22_humidity"), round(s.humidityPct, 2), qualityFlag(), "simulated"],
      };
    },
    // BMP280 pressure
    async (nodeId, now, client) => {
      const s = stateFor(nodeId);
      s.pressureHpa = walk(s.pressureHpa, 1013, 0.15, 970, 1040);
      return {
        table: "pressure_readings",
        values: [now, nodeId, await sensorInstanceId(client, nodeId, "bmp280_pressure"), round(s.pressureHpa, 1), round((s.pressureHpa - 1013) * 0.3, 2), qualityFlag(), "simulated"],
      };
    },
  );
}

// Insertion -------------------------------------------------------------------

function insertReading(client: PoolClient, reading: Reading): Promise<void> {
  const placeholders = reading.values.map((_, i) => `$${i + 1}`).join(", ");
  // Retried transmissions overwrite rather than duplicate (NEXT_STEPS.md §6);
  // node_health rows have no mutable columns, so they just ignore conflicts.
  const conflict = reading.conflictUpdate
    ? `ON CONFLICT (time, node_id) DO UPDATE SET ${reading.conflictUpdate}`
    : "ON CONFLICT (time, node_id) DO NOTHING";
  return client
    .query(`INSERT INTO ${reading.table} VALUES (${placeholders}) ${conflict}`, reading.values)
    .then(() => undefined);
}

/**
 * One health telemetry step for a node. Solar-charged battery: drains at
 * night, recharges by day. Rare brief outages make the node report nothing
 * (health and sensor readings both gap, like a real dropped connection).
 */
function nextHealth(state: NodeSimState, nodeId: string, now: Date): Reading {
  const hour = now.getHours();
  const isDaytime = hour >= 6 && hour < 18;

  if (state.outageTicksLeft > 0) {
    state.outageTicksLeft -= 1;
    state.online = false;
    state.uptimeSeconds = 0;
  } else if (Math.random() < 0.002) {
    state.outageTicksLeft = 12 + randomInt(0, 30); // 1–3.5 minutes
    state.online = false;
    state.uptimeSeconds = 0;
  } else {
    state.online = true;
    state.uptimeSeconds += TICK_MS / 1000;
  }

  const solar = isDaytime ? 0.02 : -0.015;
  state.batteryPct = clamp(state.batteryPct + solar + (Math.random() - 0.5) * 0.02, 5, 100);
  state.signalDbm = clamp(
    state.signalDbm + (Math.random() - 0.5) * 2,
    -110,
    -45,
  );

  return {
    table: "node_health",
    values: [
      now,
      nodeId,
      round(state.batteryPct, 1),
      round(3.0 + (state.batteryPct / 100) * 1.2, 2),
      Math.round(state.signalDbm),
      state.online,
      Math.round(state.uptimeSeconds),
    ],
  };
}

/** One simulated telemetry cycle: health + sensor rows per node, then risk evaluation. */
export async function simulateCycle(): Promise<number> {
  const { rows: nodes } = await pool.query<{ id: string; node_type: string }>(
    `SELECT id, node_type FROM nodes WHERE status = 'active'`,
  );
  let written = 0;
  for (const node of nodes) {
    const state = stateFor(node.id);
    const now = new Date();

    // Health telemetry runs for every node — a deployed node is alive even
    // before sensors are mounted. An offline node reports nothing at all
    // (its sensor charts show realistic gaps).
    const wasOnline = state.online;
    const health = nextHealth(state, node.id, now);
    const isOnline = health.values[5] as boolean;
    const nodeBuilders = builders[node.node_type];

    if (wasOnline !== isOnline) {
      publishNodeStatus({
        node_id: node.id,
        online: isOnline,
        battery_pct: health.values[2] as number,
        signal_dbm: health.values[4] as number,
        time: now.toISOString(),
      });
    }

    const client = await pool.connect();
    try {
      await insertReading(client, health);
      written += 1;
      if (nodeBuilders && isOnline) {
        for (const build of nodeBuilders) {
          const reading = await build(node.id, now, client);
          if (reading) {
            await insertReading(client, reading);
            written += 1;
            const m = READING_META[reading.table];
            if (m) {
              const values: Record<string, unknown> = {};
              m.valueColumns.forEach((col, i) => {
                values[col] = reading.values[3 + i];
              });
              publishReading({
                node_id: node.id,
                sensor: m.sensor,
                time: (reading.values[0] as Date).toISOString(),
                values,
              });
            }
          }
        }
      }
    } finally {
      client.release();
    }
  }

  // Fuse the fresh readings into risk assessments + alerts (best effort —
  // an engine failure must never stall ingestion).
  try {
    await runRiskEngine();
  } catch (err) {
    console.error("[risk-engine] evaluation failed:", err instanceof Error ? err.message : err);
  }
  return written;
}

let timer: NodeJS.Timeout | null = null;

export function startSimulator(intervalMs = TICK_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    simulateCycle().catch((err) =>
      console.error("[simulator] cycle failed:", err instanceof Error ? err.message : err),
    );
  }, intervalMs);
  console.log(`[simulator] live mock ingestion started (every ${intervalMs / 1000}s)`);
}

export function stopSimulator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
