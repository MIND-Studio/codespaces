-- Issues live canonically in the owner's Solid Pod as Turtle, under
-- `{podRoot}/codespaces/{repo}/issues/{number}/issue.ttl` (with
-- `comments/{cid}.ttl` siblings). This table is the *index* — fast
-- list/filter queries without round-tripping the pod. The pod is the
-- source of truth; if the index is wiped, a re-fetch from the pod
-- would rebuild it.
--
-- `number` is per-repo (1, 2, 3 …) so URLs read like
-- `/repos/alice/bakery/issues/3` — matching GitHub/GitLab muscle memory.

CREATE TABLE issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open',     -- 'open' | 'closed'
  priority      TEXT    NOT NULL DEFAULT 'normal',   -- 'low' | 'normal' | 'high'
  author_webid  TEXT    NOT NULL,                    -- foaf:Agent who filed it
  labels        TEXT    NOT NULL DEFAULT '',         -- comma-separated, lower-case
  pod_url       TEXT    NOT NULL,                    -- canonical Turtle resource on the pod
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (repo_id, number)
);

CREATE INDEX idx_issues_repo_status ON issues (repo_id, status, updated_at DESC);
CREATE INDEX idx_issues_repo_updated ON issues (repo_id, updated_at DESC);

CREATE TABLE issue_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id      INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_webid  TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  pod_url       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_issue_comments_issue ON issue_comments (issue_id, created_at ASC);
