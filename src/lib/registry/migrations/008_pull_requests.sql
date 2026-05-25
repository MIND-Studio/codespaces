-- Pull requests as a real registry primitive (not just a branch in a
-- bare repo). One row per PR. Numbered per repo, independent of issues.
-- agent_run_id links back to the engineer run that produced a PR so the
-- run detail page can deep-link to it.

CREATE TABLE pull_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id        INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  title          TEXT    NOT NULL,
  body           TEXT    NOT NULL DEFAULT '',
  source_branch  TEXT    NOT NULL,
  target_branch  TEXT    NOT NULL,
  source_sha     TEXT    NOT NULL,
  -- 'open' while the PR is reviewable, 'merged' once it's landed,
  -- 'closed' when discarded without merging.
  status         TEXT    NOT NULL,
  author_web_id  TEXT,
  -- Optional issue this PR closes when it merges.
  issue_id       INTEGER REFERENCES issues(id) ON DELETE SET NULL,
  -- Optional engineer run that opened this PR.
  agent_run_id   INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  -- SHA of the merge commit on the target branch after a successful merge.
  merge_sha      TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  merged_at      INTEGER,
  closed_at      INTEGER,
  UNIQUE (repo_id, number),
  UNIQUE (repo_id, source_branch, target_branch, status)
);

CREATE INDEX idx_pull_requests_repo ON pull_requests (repo_id, created_at DESC);
