/**
 * Forecast module (Phase 1 heuristic): least-squares linear trend over the
 * last 24h of hourly aggregates, projected over a short horizon.
 *
 * Deliberately simple and explainable — the interface (load → fit → predict)
 * is the seam where a trained model can replace the heuristic later without
 * touching the risk engine or the API.
 */
import type { Pool, PoolClient } from "pg";

export interface TrendFit {
  slopePerHour: number;
  intercept: number;
  r2: number;
  samples: number;
  /** Hours since the oldest sample that the fit covers. */
  xNow: number;
}

interface MetricSource {
  cagg: string;
  column: string;
  label: string;
}

const HAZARD_METRIC: Record<string, MetricSource> = {
  flood: { cagg: "water_level_hourly", column: "avg_level_cm", label: "level_cm" },
  fire: { cagg: "gas_readings_hourly", column: "avg_gas_ppm", label: "gas_ppm" },
  air_quality_forest: { cagg: "gas_readings_hourly", column: "avg_gas_ppm", label: "gas_ppm" },
  air_quality_water: { cagg: "turbidity_readings_hourly", column: "avg_turbidity_ntu", label: "turbidity_ntu" },
};

export function metricSourceFor(hazard: string, nodeType: string): MetricSource | null {
  if (hazard === "air_quality") {
    return HAZARD_METRIC[nodeType === "water" ? "air_quality_water" : "air_quality_forest"] ?? null;
  }
  return HAZARD_METRIC[hazard] ?? null;
}

/** Ordinary least squares over (hours-since-oldest, value) pairs. */
export function linearFit(samples: { x: number; y: number }[]): TrendFit | null {
  const n = samples.length;
  if (n < 6) return null;
  const sx = samples.reduce((a, s) => a + s.x, 0);
  const sy = samples.reduce((a, s) => a + s.y, 0);
  const sxx = samples.reduce((a, s) => a + s.x * s.x, 0);
  const sxy = samples.reduce((a, s) => a + s.x * s.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const mean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const s of samples) {
    const predicted = intercept + slope * s.x;
    ssTot += (s.y - mean) ** 2;
    ssRes += (s.y - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slopePerHour: slope, intercept, r2, samples: n, xNow: sx / n + (n - 1) / 2 };
}

export function predictAt(fit: TrendFit, hoursFromNow: number): number {
  return fit.intercept + fit.slopePerHour * (fit.xNow + hoursFromNow);
}

/** Fit quality shrinks with distance: confidence decays ~7% per hour out. */
export function confidenceAt(fit: TrendFit, hoursFromNow: number): number {
  const base = 0.55 + 0.4 * fit.r2;
  return Math.round(Math.min(0.95, Math.max(0.1, base - 0.07 * hoursFromNow)) * 100) / 100;
}

/** Last 24h of the hazard's driving metric, one sample per hourly bucket.
 *  x = hours since the oldest bucket (gap-safe, unlike plain indices). */
export async function loadHourlyMetric(
  db: Pool | PoolClient,
  nodeId: string,
  hazard: string,
  nodeType: string,
): Promise<{ metric: string; samples: { x: number; y: number }[]; fit: TrendFit | null }> {
  const source = metricSourceFor(hazard, nodeType);
  if (!source) return { metric: "unknown", samples: [], fit: null };
  const { rows } = await (db as Pool).query<{ bucket: Date; y: number | null }>(
    `SELECT bucket, ${source.column} AS y FROM ${source.cagg}
     WHERE node_id = $1 AND bucket >= now() - INTERVAL '24 hours' ORDER BY bucket`,
    [nodeId],
  );
  const valued = rows.filter((r) => r.y !== null);
  if (valued.length === 0) return { metric: source.label, samples: [], fit: null };
  const oldest = new Date(valued[0].bucket).getTime();
  const samples = valued.map((r) => ({
    x: (new Date(r.bucket).getTime() - oldest) / 3_600_000,
    y: r.y as number,
  }));
  const fit = linearFit(samples);
  if (fit) {
    // "now" is the newest bucket's position on the fit's x-axis.
    fit.xNow = samples[samples.length - 1].x;
  }
  return { metric: source.label, samples, fit };
}

export const MAX_HORIZON_HOURS = 6;
export const HISTORY_HOURS = 24;
