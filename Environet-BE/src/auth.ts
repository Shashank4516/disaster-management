/**
 * JWT auth: login, current-user lookup, admin seeding, and the requireAuth
 * middleware for authority-only endpoints (ENDPOINTS.md §3).
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "12h";

if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET not set — using insecure dev default");
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; username: string; role: string };
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

/** Must come after requireAuth — restricts a route to admin users. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "admin role required" });
    return;
  }
  next();
}

export interface AuthRoutesDeps {
  pool: Pool;
}

export function registerAuthRoutes(app: import("express").Express, deps: AuthRoutesDeps): void {
  const { pool } = deps;

  // POST /api/auth/login { username, password } → { token, user }
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    try {
      const { rows } = await pool.query<{ id: number; username: string; role: string; password_hash: string }>(
        `SELECT id, username, role, password_hash FROM users WHERE username = $1`,
        [username],
      );
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        res.status(401).json({ error: "invalid credentials" });
        return;
      }
      const safeUser: AuthUser = { id: user.id, username: user.username, role: user.role };
      res.status(200).json({ token: signToken(safeUser), user: safeUser });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/auth/me → current user from bearer token
  app.get("/api/auth/me", requireAuth, async (req: AuthedRequest, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  // ------------------------------------------------------------------
  // User management (admin only) — ENDPOINTS.md §6
  // ------------------------------------------------------------------

  const VALID_ROLES = new Set(["admin", "authority", "viewer"]);

  // GET /api/users
  app.get("/api/users", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, username, role, created_at FROM users ORDER BY id`,
      );
      res.status(200).json({ users: rows, count: rows.length });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/users { username, password, role }
  app.post("/api/users", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "username must be 3-32 chars (letters, digits, _ . -)" });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (role !== undefined && !VALID_ROLES.has(role)) {
      res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(", ")}` });
      return;
    }
    try {
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
         RETURNING id, username, role, created_at`,
        [username, hash, role ?? "authority"],
      );
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (err instanceof Error && err.message.includes("users_username_key")) {
        res.status(409).json({ error: "username already exists" });
        return;
      }
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/users/:id
  app.delete("/api/users/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "invalid user id" });
      return;
    }
    if (req.user && req.user.id === id) {
      res.status(409).json({ error: "you cannot delete your own account" });
      return;
    }
    try {
      // alerts.acknowledged_by and alert_events.actor_user_id reference users —
      // refuse deletion rather than silently destroying the audit trail.
      const { rows } = await pool.query<{ alerts: boolean; events: boolean }>(
        `SELECT
           EXISTS(SELECT 1 FROM alerts WHERE acknowledged_by = $1) AS alerts,
           EXISTS(SELECT 1 FROM alert_events WHERE actor_user_id = $1) AS events`,
        [id],
      );
      if (rows[0].alerts || rows[0].events) {
        res.status(409).json({
          error: "user has alert history (acknowledgements/events); deactivate instead of deleting",
        });
        return;
      }
      const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
      if (!rowCount) {
        res.status(404).json({ error: "user not found" });
        return;
      }
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Create the admin account from env if it does not exist yet (never overwrites). */
export async function seedAdminUser(pool: Pool): Promise<void> {
  const username = process.env.AUTH_ADMIN_USERNAME || "admin";
  const password = process.env.AUTH_ADMIN_PASSWORD || "admin123";
  try {
    const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
    if (rowCount) return;
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      [username, hash],
    );
    if (!process.env.AUTH_ADMIN_PASSWORD) {
      console.warn(`[auth] seeded admin user "${username}" with default password "admin123" — set AUTH_ADMIN_PASSWORD`);
    }
  } catch (err) {
    console.error("[auth] admin seeding failed:", err instanceof Error ? err.message : err);
  }
}
