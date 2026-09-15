import { Pool } from "pg";

const DEFAULT_DATABASE_URL =
  "postgres://environet:environet@localhost:5432/environet_db";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

export interface DatabaseStatus {
  status: "up";
  pgVersion: string;
  timescaledbVersion: string | null;
  latencyMs: number;
}

export async function checkDatabase(): Promise<DatabaseStatus> {
  const startedAt = performance.now();
  const { rows } = await pool.query<{
    pg_version: string;
    timescaledb_version: string | null;
  }>(
    `SELECT version() AS pg_version,
            (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb')
              AS timescaledb_version`,
  );
  return {
    status: "up",
    pgVersion: rows[0].pg_version,
    timescaledbVersion: rows[0].timescaledb_version,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}
