-- The team module was renamed to "agents" so that the word "team" can
-- later refer to human collaborators with project access. Rename the
-- table + its indexes in lockstep. ALTER TABLE … RENAME preserves rows;
-- indexes survive the rename but keep their old names, so drop + create
-- them too to keep the schema consistent.

ALTER TABLE team_runs RENAME TO agent_runs;
DROP INDEX IF EXISTS idx_team_runs_issue;
DROP INDEX IF EXISTS idx_team_runs_repo;
CREATE INDEX idx_agent_runs_issue ON agent_runs (issue_id, created_at DESC);
CREATE INDEX idx_agent_runs_repo ON agent_runs (repo_id, created_at DESC);
