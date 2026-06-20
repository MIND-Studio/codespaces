import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  getProvider,
  isProviderName,
  PROVIDERS,
  type ProviderName,
} from "@/lib/ai-providers/providers";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/registry/db";

/**
 * Encrypted vault for per-user provider API keys + a single-row prefs
 * table that records which (provider, model) the coder should use for
 * this user's repos.
 *
 * Envelope format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>` — identical
 * to `registry/identities.ts`. Same IDENTITY_ENCRYPTION_KEY is reused so
 * operators only have to manage one secret.
 */

const CIPHER_VERSION = "v1";

function encrypt(plaintext: string): string {
  const key = getEnv().identityEncryptionKey;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CIPHER_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(stored: string): string | null {
  if (!stored.startsWith(`${CIPHER_VERSION}:`)) return null;
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv("aes-256-gcm", getEnv().identityEncryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
  } catch (e) {
    console.warn("[ai-providers] decrypt failed:", e);
    return null;
  }
}

function makeHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `…${trimmed.slice(-4)}`;
}

// -----------------------------------------------------------------------
// Provider keys
// -----------------------------------------------------------------------

export type ConfiguredProvider = {
  provider: ProviderName;
  hint: string;
  createdAt: number;
  updatedAt: number;
};

export function setUserApiKey(
  webId: string,
  provider: ProviderName,
  apiKey: string,
): ConfiguredProvider {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("api key must not be empty");
  const enc = encrypt(trimmed);
  const hint = makeHint(trimmed);
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO user_ai_providers (web_id, provider, api_key_enc, hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(web_id, provider) DO UPDATE
         SET api_key_enc = excluded.api_key_enc,
             hint        = excluded.hint,
             updated_at  = excluded.updated_at`,
  ).run(webId, provider, enc, hint, now, now);
  return { provider, hint, createdAt: now, updatedAt: now };
}

export function deleteUserApiKey(webId: string, provider: ProviderName): void {
  const db = getDb();
  db.prepare("DELETE FROM user_ai_providers WHERE web_id = ? AND provider = ?").run(
    webId,
    provider,
  );
  // If the deleted provider was the user's selected default, blank the
  // pref so the coder falls back to env. We could keep it and let the
  // resolver detect "selected provider missing key", but blanking is
  // less surprising — the UI shows "no model selected" and the user
  // picks again.
  db.prepare(
    `UPDATE user_ai_prefs
        SET provider = NULL, model = NULL, updated_at = ?
      WHERE web_id = ? AND provider = ?`,
  ).run(Date.now(), webId, provider);
}

export function listConfiguredProviders(webId: string): ConfiguredProvider[] {
  const rows = getDb()
    .prepare(
      `SELECT provider, hint, created_at, updated_at
         FROM user_ai_providers
        WHERE web_id = ?
        ORDER BY provider`,
    )
    .all(webId) as Array<{
    provider: string;
    hint: string;
    created_at: number;
    updated_at: number;
  }>;
  return rows
    .filter((r) => isProviderName(r.provider))
    .map((r) => ({
      provider: r.provider as ProviderName,
      hint: r.hint,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

/** Decrypts and returns the plaintext key. Server-only; never sent over
 *  the wire. The coder driver calls this just before spawning docker. */
export function getDecryptedApiKey(webId: string, provider: ProviderName): string | null {
  const row = getDb()
    .prepare("SELECT api_key_enc FROM user_ai_providers WHERE web_id = ? AND provider = ?")
    .get(webId, provider) as { api_key_enc: string } | undefined;
  if (!row) return null;
  return decrypt(row.api_key_enc);
}

// -----------------------------------------------------------------------
// Preferences (which provider+model to use)
// -----------------------------------------------------------------------

export type UserAiPref = {
  provider: ProviderName | null;
  model: string | null;
  updatedAt: number | null;
};

export function getUserAiPref(webId: string): UserAiPref {
  const row = getDb()
    .prepare("SELECT provider, model, updated_at FROM user_ai_prefs WHERE web_id = ?")
    .get(webId) as
    | { provider: string | null; model: string | null; updated_at: number }
    | undefined;
  if (!row) return { provider: null, model: null, updatedAt: null };
  const provider = isProviderName(row.provider) ? row.provider : null;
  return {
    provider,
    model: row.model ?? null,
    updatedAt: row.updated_at,
  };
}

export function setUserAiPref(
  webId: string,
  pref: { provider: ProviderName | null; model: string | null },
): UserAiPref {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO user_ai_prefs (web_id, provider, model, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(web_id) DO UPDATE
         SET provider = excluded.provider,
             model = excluded.model,
             updated_at = excluded.updated_at`,
    )
    .run(webId, pref.provider, pref.model, now);
  return { provider: pref.provider, model: pref.model, updatedAt: now };
}

// -----------------------------------------------------------------------
// Resolver used by the coder driver
// -----------------------------------------------------------------------

export type CoderConfig = {
  source: "user-pref" | "env-fallback";
  provider: ProviderName;
  /** Bare model id (no prefix). */
  model: string;
  apiKey: string;
};

/**
 * Resolve which (provider, model, apiKey) the coder should use when
 * acting on behalf of `webId`.
 *
 * Priority:
 *   1. The user's pref + their stored key for that provider.
 *   2. The bridge-wide OPENROUTER_API_KEY + MIND_AGENT_MODEL fallback
 *      (preserves the demo behavior — anyone can push a repo and have
 *      the agents work without configuring anything personally).
 *   3. null — caller surfaces the configuration error to the user.
 */
export function resolveCoderConfig(webId: string): CoderConfig | null {
  const pref = getUserAiPref(webId);
  if (pref.provider && pref.model) {
    const apiKey = getDecryptedApiKey(webId, pref.provider);
    if (apiKey) {
      return {
        source: "user-pref",
        provider: pref.provider,
        model: pref.model,
        apiKey,
      };
    }
  }

  // Fallback: env-configured OpenRouter setup. The MIND_AGENT_MODEL var
  // includes a provider slash (e.g. "qwen/qwen3-coder:free") and is
  // consumed as the bare model id by OpenRouter, so we forward it
  // as-is. Default is a free model so a deployment with no per-user
  // BYOK keys still completes a run end-to-end.
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) {
    return {
      source: "env-fallback",
      provider: "openrouter",
      model: process.env.MIND_AGENT_MODEL ?? "qwen/qwen3-coder:free",
      apiKey: envKey,
    };
  }
  return null;
}

/** UI-safe variant: same priority order but without decrypting the key.
 *  Used to render "this repo will use X" in the settings page. */
export type CoderConfigSummary =
  | {
      source: "user-pref";
      provider: ProviderName;
      providerLabel: string;
      model: string;
    }
  | {
      source: "env-fallback";
      provider: "openrouter";
      providerLabel: string;
      model: string;
    }
  | { source: "none" };

export function resolveCoderConfigSummary(webId: string): CoderConfigSummary {
  const pref = getUserAiPref(webId);
  if (pref.provider && pref.model) {
    const has = !!getDecryptedApiKey(webId, pref.provider);
    if (has) {
      const spec = getProvider(pref.provider);
      return {
        source: "user-pref",
        provider: pref.provider,
        providerLabel: spec?.label ?? pref.provider,
        model: pref.model,
      };
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      source: "env-fallback",
      provider: "openrouter",
      providerLabel: "OpenRouter (bridge-default)",
      model: process.env.MIND_AGENT_MODEL ?? "qwen/qwen3-coder:free",
    };
  }
  return { source: "none" };
}

export { PROVIDERS };
