-- 013_user_ai_providers.sql
--
-- Per-user "bring your own key" vault for AI providers, plus a single-row
-- preference table that picks which (provider, model) the coder uses for
-- this user's repos.
--
-- Keys live encrypted (AES-256-GCM, v1:iv:tag:ct envelope) under the same
-- IDENTITY_ENCRYPTION_KEY that protects Solid refresh tokens. The bridge
-- never returns the plaintext to the client — only "(configured · masked)"
-- summaries. The coder driver decrypts at run time and forwards the key
-- into the sandboxed opencode container via process env, never via CLI
-- args (so the key doesn't appear in `ps auxe`).

CREATE TABLE IF NOT EXISTS user_ai_providers (
  web_id      TEXT NOT NULL,
  provider    TEXT NOT NULL,            -- 'openrouter' | 'google' | 'anthropic' | 'openai'
  api_key_enc TEXT NOT NULL,            -- v1:iv:tag:ct
  hint        TEXT NOT NULL DEFAULT '', -- last 4 chars in plaintext, shown in the UI
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (web_id, provider)
);

CREATE TABLE IF NOT EXISTS user_ai_prefs (
  web_id     TEXT PRIMARY KEY,
  provider   TEXT,                -- must match a user_ai_providers row for this web_id
  model      TEXT,                -- model id, e.g. 'google/gemini-2.5-pro'
  updated_at INTEGER NOT NULL
);
