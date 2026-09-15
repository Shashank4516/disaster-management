/**
 * HTTP ingestion (ENDPOINTS.md §2) — the fallback write path for real sensor
 * nodes when MQTT is unavailable, and the tool for manual tests/backfills.
 *
 * Auth is per-node via the `X-API-Key` header (key issued at node registration);
 * a node can only write its own readings. Accepts a single reading or a batch.
 * Readings are attributed to the node's active sensor instance automatically
 * (calibration history), unless `sensor_instance_id` is provided explicitly.
 */
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { SENSORS } from "./nodes.js";

export interface IngestRoutesDeps {
  pool: Pool;
}

const MAX_BATCH = 100;
const QUALITY_FLAGS = new Set([-1, 0, 1]);

interface ValidatedReading {
  table: string;
  sensorName: string;
  time: Date;
  values: Record<string, number | boolean>;
  qualityFlag: number;
  source: string;
  explicitInstanceId?: number;
}

export function registerIngestRoutes(app: import("express").Express, deps: IngestRoutesDeps): void {
  const { pool } = deps;

  app.post("/api/ingest", async (req: Request, res: Response) => {
    const apiKey = req.header("x-api-key");
    if (!apiKey) {
      res.status(401).json({ ack: false, error: "missing X-API-Key header" });
      return;
    }
    let nodeId: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM nodes WHERE api_key = $1 AND status = 'active'`,
        [apiKey],
      );
      if (!rows[0]) {
        res.status(401).json({ ack: false, error: "invalid API key or inactive node" });
        return;
      }
      nodeId = rows[0].id;
    } catch (err) {
      res.status(503).json({ ack: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const body = req.body ?? {};
    const entries: Record<string, unknown>[] = Array.isArray(body.readings) ? body.readings : [body];
    if (entries.length === 0 || entries.length > MAX_BATCH) {
      res.status(400).json({ ack: false, error: `readings batch must contain 1-${MAX_BATCH} entries` });
      return;
    }

    // Validate everything before writing anything — a batch is all-or-nothing.
    const readings: ValidatedReading[] = [];
    for (let i = 0; i < entries.length; i++) {
      const result = validateReading(nodeId, entries[i]);
      if ("error" in result) {
        res.status(400).json({ ack: false, error: `reading ${i}: ${result.error}` });
        return;
      }
      readings.push(result);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const instanceCache = new Map<string, number | null>();
      for (const r of readings) {
        let instanceId = r.explicitInstanceId;
        if (instanceId === undefined) {
          const key = `${nodeId}:${r.sensorName}`;
          if (!instanceCache.has(key)) {
            instanceCache.set(key, await resolveSensorInstanceId(client, nodeId, r.sensorName));
          }
          const cached = instanceCache.get(key);
          instanceId = cached ?? undefined;
        }

        // Omit sensor_instance_id entirely when unknown so upserts never
        // overwrite a known calibration attribution with null.
        const cols = ["time", "node_id"];
        const params: unknown[] = [r.time.toISOString(), nodeId];
        if (instanceId !== null) {
          cols.push("sensor_instance_id");
          params.push(instanceId);
        }
        cols.push(...Object.keys(r.values));
        params.push(...Object.values(r.values));
        cols.push("quality_flag", "source");
        params.push(r.qualityFlag, r.source);

        const updateSet = cols
          .filter((c) => c !== "time" && c !== "node_id")
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(", ");
        await client.query(
          `INSERT INTO ${r.table} (${cols.join(", ")})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
           ON CONFLICT (time, node_id) DO UPDATE SET ${updateSet}`,
          params,
        );
      }
      await client.query("COMMIT");
      res.status(200).json({ ack: true, accepted: readings.length });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      res.status(503).json({ ack: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });
}

/** Validate one ingest entry against its sensor table. */
function validateReading(
  authNodeId: string,
  entry: Record<string, unknown>,
): ValidatedReading | { error: string } {
  if (typeof entry !== "object" || entry === null) return { error: "entry must be an object" };

  const entryNodeId = entry.node_id ?? authNodeId;
  if (entryNodeId !== authNodeId) {
    return { error: `node_id "${String(entryNodeId)}" does not match the authenticated node` };
  }

  const sensorName = String(entry.sensor ?? "");
  const sensor = SENSORS[sensorName];
  if (!sensor) return { error: `unknown sensor "${sensorName}"` };

  let time: Date;
  if (entry.time === undefined || entry.time === null) {
    time = new Date();
  } else {
    time = new Date(String(entry.time));
    if (Number.isNaN(time.getTime())) return { error: `invalid time "${String(entry.time)}"` };
  }

  const rawValues = (entry.values ?? {}) as Record<string, unknown>;
  const values: Record<string, number | boolean> = {};
  for (const col of sensor.rawCols) {
    if (rawValues[col] === undefined) continue;
    if (col === "detected") {
      if (typeof rawValues[col] !== "boolean") return { error: "detected must be a boolean" };
    } else if (typeof rawValues[col] !== "number") {
      return { error: `value "${col}" must be a number` };
    }
    values[col] = rawValues[col] as number | boolean;
  }
  if (Object.keys(values).length === 0) {
    return { error: `values must contain at least one of: ${sensor.rawCols.join(", ")}` };
  }

  const qualityFlag = rawValues.quality_flag ?? entry.quality_flag ?? 1;
  if (typeof qualityFlag !== "number" || !QUALITY_FLAGS.has(qualityFlag)) {
    return { error: "quality_flag must be -1, 0, or 1" };
  }

  const source = entry.source ?? "real";
  if (source !== "real" && source !== "simulated") {
    return { error: 'source must be "real" or "simulated"' };
  }

  const explicitInstanceId = entry.sensor_instance_id;
  if (explicitInstanceId !== undefined && explicitInstanceId !== null && !Number.isInteger(explicitInstanceId)) {
    return { error: "sensor_instance_id must be an integer" };
  }

  return {
    table: sensor.table,
    sensorName,
    time,
    values,
    qualityFlag,
    source,
    explicitInstanceId: explicitInstanceId === null ? undefined : (explicitInstanceId as number | undefined),
  };
}

/** Resolve a node's active sensor instance for (node, sensor type); used to
 *  attribute readings to a calibration record. Returns null when absent. */
async function resolveSensorInstanceId(
  client: import("pg").PoolClient,
  nodeId: string,
  sensorName: string,
): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT ns.id FROM node_sensors ns
     JOIN sensor_types st ON st.id = ns.sensor_type_id
     WHERE ns.node_id = $1 AND st.name = $2 AND ns.active
     ORDER BY ns.id LIMIT 1`,
    [nodeId, sensorName],
  );
  return rows[0]?.id ?? null;
}
