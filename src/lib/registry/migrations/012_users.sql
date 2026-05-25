-- §4 multi-user: track who signed up through the bridge.
--
-- The bridge's `repos.owner` column is a free string today; the
-- registry doesn't enforce that an owner has actually proven control
-- of any pod. The repo-create flow's pod-root verification (P0-S5)
-- catches the obvious abuse, but for "managed multi-user" we want a
-- first-class users table — eventually keyed to a Foreign Key on
-- `repos.owner_slug` — so we can:
--   • count signups for capacity planning
--   • enforce per-user quotas (already wired by env defaults; the
--     row is what an operator overrides later)
--   • surface a /people/{slug} profile page from one source of truth
--
-- The FK rewrite is intentionally NOT in this migration — it requires
-- touching every `repos.owner = ?` query and is a longer follow-up.
-- For now the users table coexists with the existing free-string
-- owner column, and the signup flow keeps them in sync.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_slug  TEXT NOT NULL UNIQUE,
  web_id      TEXT NOT NULL UNIQUE,
  pod_root    TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_users_email ON users (email);
