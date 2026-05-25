-- P0-R4 second half: HEAD vs last_published_sha reconciler.
--
-- A `git push` succeeds the moment git-receive-pack finishes — but the
-- post-receive hook that fires the bridge's publisher is best-effort.
-- If the hook callback fails (bridge crash, transient 5xx, hook script
-- removed by a manual repo restore), the bare repo's HEAD advances
-- silently and the pod stays on stale content.
--
-- We close the window by writing HEAD's SHA into the pages_configs row
-- on every successful publish. On boot + on a timer the reconciler
-- walks every repo, compares `git rev-parse <sourceBranch>` to
-- `last_published_sha`, and re-runs the publisher when they diverge.
--
-- Column:
--   last_published_sha — 40-char git SHA1 of the commit last published;
--                        NULL means "never published" or "legacy row".

ALTER TABLE pages_configs ADD COLUMN last_published_sha TEXT;
