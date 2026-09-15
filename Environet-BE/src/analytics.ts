/**
 * Analytics endpoints (ENDPOINTS.md §1): heuristic forecast per node+hazard.
 * Phase 3 (a trained model) would replace the linear fit inside forecast.ts
 * without changing this contract.
 */
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { requireAuth } from "./auth.js";
import {
  MAX_HORIZON_HOURS,
  HISTORY_HOURS,
  confidenceAt,
  loadHourlyMetric,
  predictAt,
} from "./forecast.js";
import { forecastLevelFor, getConfig } from "./riskEngine.js";

export interface AnalyticsRoutesDeps {
  pool: Pool;
}

export function registerAnalyticsRoutes(app: import("express").Express, deps: AnalyticsRoutesDeps): void {
  const { pool } = deps;

  // GET /api/analytics/forecast?node=W01&hazard=flood&horizon=3
  app.get("/api/analytics/forecast", requireAuth, async (req: Request, res: Response) => {
    const nodeId = String(req.query.node ?? "");
    const hazard = String(req.query.hazard ?? "");
    const horizonRaw = Number(req.query.horizon ?? 3);
    if (!nodeId) {
      res.status(400).json({ error: "query param \"node\" is required" });
      return;
    }
    if (!["fire", "flood", "air_quality"].includes(hazard)) {
      res.status(400).json({ error: `unknown hazard "${hazard}"`, valid: ["fire", "flood", "air_quality"] });
      return;
    }
    if (!Number.isFinite(horizonRaw) || horizonRaw < 1 || horizonRaw > MAX_HORIZON_HOURS) {
      res.status(400).json({ error: `horizon must be 1-${MAX_HORIZON_HOURS} hours` });
      return;
    }
    const horizon = Math.floor(horizonRaw);

    try {
      const node = await pool.query<{ node_type: string }>(
        `SELECT node_type FROM nodes WHERE id = $1`,
        [nodeId],
      );
      if (!node.rowCount) {
        res.status(404).json({ error: "node not found" });
        return;
      }
      const nodeType = node.rows[0].node_type;

      const [client, current, config] = await Promise.all([
        pool.connect(),
        pool.query(
          `SELECT DISTINCT ON (hazard_type) risk_level, time AS assessed_at
           FROM risk_assessments WHERE node_id = $1 AND hazard_type = $2
           ORDER BY hazard_type, time DESC`,
          [nodeId, hazard],
        ),
        getConfig(pool, nodeId),
      ]);
      try {
        const { metric, samples, fit } = await loadHourlyMetric(client, nodeId, hazard, nodeType);
        if (!fit) {
          res.status(200).json({
            node_id: nodeId,
            hazard,
            metric,
            method: "linear-trend-v1",
            available: false,
            reason: `need at least 6 hourly samples of ${metric}, found ${samples.length}`,
            current_risk_level: current.rows[0]?.risk_level ?? null,
          });
          return;
        }

        const points = Array.from({ length: horizon }, (_, i) => {
          const h = i + 1;
          const value = predictAt(fit, h);
          return {
            horizon_hours: h,
            time: new Date(Date.now() + h * 3_600_000).toISOString(),
            predicted_value: Math.round(value * 100) / 100,
            predicted_risk_level: forecastLevelFor(metric, value, config.thresholds),
            confidence: confidenceAt(fit, h),
          };
        });

        res.status(200).json({
          node_id: nodeId,
          hazard,
          metric,
          method: "linear-trend-v1",
          available: true,
          history_hours: HISTORY_HOURS,
          current_risk_level: current.rows[0]?.risk_level ?? null,
          trend: {
            slope_per_hour: Math.round(fit.slopePerHour * 1000) / 1000,
            r2: Math.round(fit.r2 * 100) / 100,
            samples: fit.samples,
          },
          predictive_escalation_enabled: config.predictive,
          points,
        });
      } finally {
        client.release();
      }
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
