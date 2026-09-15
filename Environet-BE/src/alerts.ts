/**
 * Alert endpoints (ENDPOINTS.md §1 + §4): filterable list, detail with the
 * full event trail, and auth-protected lifecycle mutations.
 */
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { requireAuth, type AuthedRequest } from "./auth.js";

const FILTERABLE = new Set(["severity", "hazard_type", "node_id", "status"]);

export interface AlertRoutesDeps {
  pool: Pool;
}

export function registerAlertRoutes(app: import("express").Express, deps: AlertRoutesDeps): void {
  const { pool } = deps;

  // GET /api/alerts?severity=&hazard_type=&node_id=&status=&from=&to=&limit=
  app.get("/api/alerts", async (req: Request, res: Response) => {
    try {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (clause: string, value: unknown): void => {
        params.push(value);
        where.push(clause.replace("$?", `$${params.length}`));
      };

      for (const key of FILTERABLE) {
        const value = req.query[key];
        if (value !== undefined && value !== "") add(`a.${key} = $?`, value);
      }
      if (req.query.from) add(`a.triggered_at >= $?::timestamptz`, req.query.from);
      if (req.query.to) add(`a.triggered_at <= $?::timestamptz`, req.query.to);

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const { rows } = await pool.query(
        `SELECT a.id, a.node_id, n.name AS node_name, a.hazard_type, a.severity, a.message,
                a.triggered_at, a.resolved_at, a.status, a.acknowledged_by, a.acknowledged_at
         FROM alerts a JOIN nodes n ON n.id = a.node_id
         ${whereSql}
         ORDER BY a.triggered_at DESC
         LIMIT $${params.length + 1}`,
        [...params, limit],
      );
      res.status(200).json({ alerts: rows, count: rows.length });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/alerts/:id — full detail including event history
  app.get("/api/alerts/:id", async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.*, n.name AS node_name
         FROM alerts a JOIN nodes n ON n.id = a.node_id
         WHERE a.id = $1`,
        [req.params.id],
      );
      if (!rows[0]) {
        res.status(404).json({ error: "alert not found" });
        return;
      }
      const { rows: events } = await pool.query(
        `SELECT e.id, e.event_type, e.note, e.actor_user_id, u.username AS actor, e.created_at
         FROM alert_events e LEFT JOIN users u ON u.id = e.actor_user_id
         WHERE e.alert_id = $1 ORDER BY e.created_at`,
        [req.params.id],
      );
      res.status(200).json({ alert: rows[0], events });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ------------------------------------------------------------------
  // Lifecycle mutations (auth required) — ENDPOINTS.md §4
  // ------------------------------------------------------------------

  const loadAlert = async (id: string): Promise<Record<string, unknown> | null> => {
    const { rows } = await pool.query(
      `SELECT a.*, n.name AS node_name FROM alerts a JOIN nodes n ON n.id = a.node_id WHERE a.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  };

  const addEvent = async (
    alertId: number,
    eventType: string,
    actorUserId: number,
    note: string | null,
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_type, note, actor_user_id) VALUES ($1, $2, $3, $4)`,
      [alertId, eventType, note, actorUserId],
    );
  };

  // PATCH /api/alerts/:id/acknowledge — active → acknowledged (idempotent)
  app.patch("/api/alerts/:id/acknowledge", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const alertId = String(req.params.id);
      const alert = await loadAlert(alertId);
      if (!alert) {
        res.status(404).json({ error: "alert not found" });
        return;
      }
      if (alert.status === "resolved") {
        res.status(409).json({ error: "resolved alerts cannot be acknowledged" });
        return;
      }
      if (alert.status === "active") {
        await pool.query(
          `UPDATE alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now() WHERE id = $1`,
          [alertId, req.user!.id],
        );
        await addEvent(Number(alertId), "acknowledged", req.user!.id, noteOr(req));
      }
      res.status(200).json({ alert: await loadAlert(alertId) });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/alerts/:id/resolve — active|acknowledged → resolved (idempotent)
  app.patch("/api/alerts/:id/resolve", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const alertId = String(req.params.id);
      const alert = await loadAlert(alertId);
      if (!alert) {
        res.status(404).json({ error: "alert not found" });
        return;
      }
      if (alert.status !== "resolved") {
        await pool.query(
          `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`,
          [alertId],
        );
        await addEvent(Number(alertId), "resolved", req.user!.id, noteOr(req));
      }
      res.status(200).json({ alert: await loadAlert(alertId) });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/alerts/:id/escalate — severity +1 up to 3 (WARNING→CRITICAL)
  app.patch("/api/alerts/:id/escalate", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const alertId = String(req.params.id);
      const alert = await loadAlert(alertId);
      if (!alert) {
        res.status(404).json({ error: "alert not found" });
        return;
      }
      if (alert.status === "resolved") {
        res.status(409).json({ error: "resolved alerts cannot be escalated" });
        return;
      }
      const severity = Number(alert.severity);
      if (severity >= 3) {
        res.status(409).json({ error: "alert is already at maximum severity (CRITICAL)" });
        return;
      }
      await pool.query(`UPDATE alerts SET severity = $2 WHERE id = $1`, [alertId, severity + 1]);
      await addEvent(Number(alertId), "escalated", req.user!.id, noteOr(req) ?? `severity ${severity} → ${severity + 1}`);
      res.status(200).json({ alert: await loadAlert(alertId) });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function noteOr(req: Request): string | null {
  const note = (req.body ?? {}).note;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}
