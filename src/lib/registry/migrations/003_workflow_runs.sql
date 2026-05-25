-- A single workflow execution. One row per run, regardless of status.
-- The runner inserts queued → running → success|failed|error in place.
-- `log_tail` is intentionally an excerpt (last ~64KB of combined
-- stdout+stderr) so we don't bloat SQLite with build noise.

CREATE TABLE workflow_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  ref           TEXT    NOT NULL,
  status        TEXT    NOT NULL,    -- queued | running | success | failed | error
  exit_code     INTEGER,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  log_tail      TEXT    NOT NULL DEFAULT '',
  error_message TEXT
);

CREATE INDEX idx_workflow_runs_repo ON workflow_runs (repo_id, started_at DESC);
