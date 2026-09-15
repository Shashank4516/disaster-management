-- Risk engine support objects (idempotent — safe to re-run).

-- Per-node tunable thresholds: the authority feedback loop (ENDPOINTS.md §5)
-- pushes updates here and the risk engine evaluates against them.
CREATE TABLE IF NOT EXISTS node_configs (
  node_id            TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nodes authenticate to the ingestion path with a per-node key.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;

-- Risk level helper used by API queries (0=NORMAL 1=WATCH 2=WARNING 3=CRITICAL).
CREATE OR REPLACE FUNCTION latest_risk_per_node()
RETURNS TABLE (
  node_id       TEXT,
  hazard_type   TEXT,
  risk_level    SMALLINT,
  confidence    REAL,
  assessed_at   TIMESTAMPTZ
) AS $$
  SELECT DISTINCT ON (node_id, hazard_type)
         node_id, hazard_type, risk_level, confidence, time AS assessed_at
  FROM risk_assessments
  ORDER BY node_id, hazard_type, time DESC;
$$ LANGUAGE SQL STABLE;
