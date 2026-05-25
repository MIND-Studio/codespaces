-- Live log support. An agent run now lives through three states:
-- 'running' while the driver is in flight, then 'ok' or 'error' on
-- completion. log_path holds the relative filename under .agent-logs/
-- where the driver streams the underlying tool's stdout+stderr; null
-- for legacy rows and for drivers that don't stream.

ALTER TABLE agent_runs ADD COLUMN log_path TEXT;
