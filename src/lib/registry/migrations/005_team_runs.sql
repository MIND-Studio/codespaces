-- One row per role-fire. Indexed by issue so the issue detail page
-- can render "what the team has said about this issue" without trawling
-- logs. Non-issue events (cron, manual against the repo) attach by
-- issue_id=NULL and surface in a future per-repo team panel.

CREATE TABLE team_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  issue_id      INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  event_type    TEXT    NOT NULL,
  role          TEXT    NOT NULL,
  driver        TEXT    NOT NULL,
  status        TEXT    NOT NULL,                 -- 'ok' | 'error'
  summary       TEXT    NOT NULL DEFAULT '',
  error_message TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_team_runs_issue ON team_runs (issue_id, created_at DESC);
CREATE INDEX idx_team_runs_repo ON team_runs (repo_id, created_at DESC);
