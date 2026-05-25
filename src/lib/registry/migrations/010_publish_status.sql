-- P0-R5 / P0-R2: surface publish failures.
--
-- Today the publisher logs to stdout, the UI reads `last_published_at`,
-- and there is no signal anywhere that a publish failed mid-upload or
-- that the owner needs to reauthorize via /connect (the latter being
-- the P0-R2 "needs-reauthorization" case after we stopped silently
-- falling back to seeded creds).
--
-- Columns:
--   last_publish_status   — 'success' | 'failed' | 'needs-reauth' | NULL (never published)
--   last_publish_error    — short error string for the UI banner; NULL on success
--   last_publish_attempt  — wall-clock ms of the most recent attempt (success or fail)

ALTER TABLE pages_configs ADD COLUMN last_publish_status TEXT;
ALTER TABLE pages_configs ADD COLUMN last_publish_error TEXT;
ALTER TABLE pages_configs ADD COLUMN last_publish_attempt INTEGER;
