-- Per-PR preview builds. A PR's source branch can be built (if it has a
-- .mind/workflow.yml) and published as a static site into a pod preview
-- container, so the result is viewable before merge. These columns track
-- that preview's lifecycle on the pull_requests row.
--   preview_status: NULL (never built) | 'building' | 'ready' | 'failed'
--   preview_url:    the published preview URL (when ready)
--   preview_sha:    the source SHA the preview was built from (SHA-guard:
--                   skip rebuilding an unchanged branch)
--   preview_log_path: filename of the streamed build log (like agent_runs)
--   preview_error:  short failure message (when failed)
ALTER TABLE pull_requests ADD COLUMN preview_status TEXT;
ALTER TABLE pull_requests ADD COLUMN preview_url TEXT;
ALTER TABLE pull_requests ADD COLUMN preview_sha TEXT;
ALTER TABLE pull_requests ADD COLUMN preview_log_path TEXT;
ALTER TABLE pull_requests ADD COLUMN preview_error TEXT;
