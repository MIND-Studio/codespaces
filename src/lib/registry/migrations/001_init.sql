-- Repository registry: the bridge's bookkeeping. Not the source of truth
-- for repository contents (that's the bare git repo on disk) nor for the
-- published site (that's the user's Solid Pod). Just enough metadata to
-- route a clone/push to the right disk path and a publish to the right
-- pod container.

CREATE TABLE repos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner           TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  owner_webid     TEXT    NOT NULL,
  owner_pod_root  TEXT    NOT NULL,
  default_branch  TEXT    NOT NULL DEFAULT 'main',
  visibility      TEXT    NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  created_at      INTEGER NOT NULL,
  UNIQUE (owner, name)
);

CREATE INDEX idx_repos_owner ON repos (owner);

CREATE TABLE pages_configs (
  repo_id            INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  enabled            INTEGER NOT NULL DEFAULT 0,     -- 0 | 1
  source_branch      TEXT    NOT NULL DEFAULT 'main',
  source_path        TEXT    NOT NULL DEFAULT '/',
  target_container   TEXT    NOT NULL DEFAULT '',
  last_published_at  INTEGER
);

-- Per-repo HTTP-Basic tokens for git push (always required) and clone
-- (when visibility=private). Stored as sha256 hashes; plaintext is shown
-- to the user once at creation time. See src/lib/registry/tokens.ts.
CREATE TABLE push_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL,
  label       TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_push_tokens_repo ON push_tokens (repo_id);
