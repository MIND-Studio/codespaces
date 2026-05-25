-- Persistent storage for Solid-OIDC delegated sessions.
--
-- The Inrupt Node SDK uses an `IStorage` (key/value) to hold all
-- per-session state: PKCE verifiers, refresh tokens, DPoP keys, issuer
-- config, etc. We back that interface with a single key/value table,
-- partitioned by `session_id` so multiple identities never collide.
--
-- A separate `identities` table maps a WebID to the session it owns,
-- so the publisher can look up `→ session_id → IStorage → Session →
-- authenticated fetch` for any WebID a user has authorized.

CREATE TABLE identity_storage (
  session_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

CREATE INDEX idx_identity_storage_session ON identity_storage (session_id);

CREATE TABLE identities (
  web_id        TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL UNIQUE,
  oidc_issuer   TEXT NOT NULL,
  connected_at  INTEGER NOT NULL
);
