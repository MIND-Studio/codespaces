-- Comments authored by an agent (the coder) carry the originating
-- agent_runs.id so the UI can render them with a coder badge and the
-- dispatcher can skip re-firing the loop on its own comments. Human
-- comments leave this column null.

ALTER TABLE issue_comments ADD COLUMN agent_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL;
