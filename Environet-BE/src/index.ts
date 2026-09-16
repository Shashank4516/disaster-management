import express, { type Request, type Response } from "express";
import { checkDatabase, pool } from "./db.js";
import { simulateCycle, startSimulator, stopSimulator } from "./simulator.js";
import { runRiskEngine } from "./riskEngine.js";
import { registerAuthRoutes, seedAdminUser } from "./auth.js";
import { registerNodeRoutes } from "./nodes.js";
import { registerAlertRoutes } from "./alerts.js";
import { registerAnalyticsRoutes } from "./analytics.js";
import { registerIngestRoutes } from "./ingest.js";
import { registerSensorRoutes } from "./sensors.js";
import { attachRealtime } from "./realtime.js";

try {
  process.loadEnvFile();
} catch {
  // .env is optional; container deployments pass env vars directly
}

const app = express();
app.use(express.json());
const PORT = Number(process.env.PORT) || 3000;

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/db/health", async (_req: Request, res: Response) => {
  try {
    const db = await checkDatabase();
    res.status(200).json(db);
  } catch (err) {
    res.status(503).json({
      status: "down",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Latest fused risk level per node per hazard (0=NORMAL 1=WATCH 2=WARNING 3=CRITICAL).
app.get("/api/nodes", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.id, n.node_type, n.name, n.latitude, n.longitude, n.status,
             n.deployed_at,
             h.online  AS latest_online,
             h.time    AS latest_health_at,
             COALESCE(
               json_agg(
                 json_build_object('hazard', r.hazard_type, 'level', r.risk_level, 'confidence', r.confidence)
                 ORDER BY r.hazard_type
               ) FILTER (WHERE r.hazard_type IS NOT NULL), '[]'
             ) AS risks
      FROM nodes n
      LEFT JOIN LATERAL (
        SELECT online, time FROM node_health WHERE node_id = n.id ORDER BY time DESC LIMIT 1
      ) h ON true
      LEFT JOIN LATERAL latest_risk_per_node() r ON r.node_id = n.id
      GROUP BY n.id, h.online, h.time
      ORDER BY n.id
    `);
    res.status(200).json({ nodes: rows });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Run one risk-engine evaluation immediately (demos/tests).
app.post("/risk/evaluate", async (_req: Request, res: Response) => {
  try {
    const result = await runRiskEngine();
    res.status(200).json({ status: "ok", ...result });
  } catch (err) {
    res.status(503).json({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
});

registerNodeRoutes(app, { pool });
registerAlertRoutes(app, { pool });
registerAuthRoutes(app, { pool });
registerAnalyticsRoutes(app, { pool });
registerIngestRoutes(app, { pool });
registerSensorRoutes(app, { pool });

// Ingestion status: row counts per reading table, newest timestamp per table.
app.get("/ingest/status", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{ table_name: string; rows: string; latest: Date | null }>(`
      SELECT 'flame_readings' AS table_name, count(*)::text AS rows, max(time) AS latest FROM flame_readings
      UNION ALL SELECT 'gas_readings', count(*)::text, max(time) FROM gas_readings
      UNION ALL SELECT 'soil_moisture_readings', count(*)::text, max(time) FROM soil_moisture_readings
      UNION ALL SELECT 'water_level_readings', count(*)::text, max(time) FROM water_level_readings
      UNION ALL SELECT 'rainfall_readings', count(*)::text, max(time) FROM rainfall_readings
      UNION ALL SELECT 'turbidity_readings', count(*)::text, max(time) FROM turbidity_readings
      UNION ALL SELECT 'temperature_readings', count(*)::text, max(time) FROM temperature_readings
      UNION ALL SELECT 'humidity_readings', count(*)::text, max(time) FROM humidity_readings
      UNION ALL SELECT 'pressure_readings', count(*)::text, max(time) FROM pressure_readings
      UNION ALL SELECT 'particulate_readings', count(*)::text, max(time) FROM particulate_readings
      UNION ALL SELECT 'node_health', count(*)::text, max(time) FROM node_health
      UNION ALL SELECT 'risk_assessments', count(*)::text, max(time) FROM risk_assessments
    `);
    res.status(200).json({
      simulatorRunning: simulatorOn,
      tables: rows.map((r) => ({
        table: r.table_name,
        rows: Number(r.rows),
        latest: r.latest,
      })),
    });
  } catch (err) {
    res.status(503).json({
      status: "down",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Manual trigger — useful for demos and tests without waiting for the tick.
app.post("/ingest/tick", async (_req: Request, res: Response) => {
  try {
    const written = await simulateCycle();
    res.status(200).json({ status: "ok", readingsWritten: written });
  } catch (err) {
    res.status(503).json({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

let simulatorOn = false;

app.post("/simulator/start", (_req: Request, res: Response) => {
  startSimulator();
  simulatorOn = true;
  res.status(200).json({ status: "started" });
});

app.post("/simulator/stop", (_req: Request, res: Response) => {
  stopSimulator();
  simulatorOn = false;
  res.status(200).json({ status: "stopped" });
});

// Auto-start live mock ingestion unless explicitly disabled.
if (process.env.SIMULATOR_DISABLED !== "true") {
  startSimulator();
  simulatorOn = true;
}

void seedAdminUser(pool);

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

attachRealtime(server);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSimulator();
    server.close(() => process.exit(0));
  });
}
