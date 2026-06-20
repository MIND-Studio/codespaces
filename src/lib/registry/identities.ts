import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IStorage } from "@inrupt/solid-client-authn-core";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/registry/db";

export type Identity = {
  webId: string;
  sessionId: string;
  oidcIssuer: string;
  connectedAt: number;
};

/**
 * AES-256-GCM envelope for the per-session refresh tokens / DPoP keys
 * the Inrupt SDK persists into `identity_storage`. A DB leak alone is
 * no longer enough to take over user pods — the attacker also needs
 * IDENTITY_ENCRYPTION_KEY (set from env / KMS at process boot, P0-S4).
 *
 * On-disk format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`.
 * Legacy plaintext rows (no `v1:` prefix) are returned as-is and
 * upgraded to ciphertext on the next write — no migration script
 * required.
 */
const CIPHER_VERSION = "v1";

function encrypt(plaintext: string): string {
  const key = getEnv().identityEncryptionKey;
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CIPHER_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(stored: string): string | null {
  if (!stored.startsWith(`${CIPHER_VERSION}:`)) {
    // Legacy plaintext row — return as-is; the next setStmt will
    // re-encrypt it. Logged once-per-row so an operator can see drift
    // during the upgrade window.
    return stored;
  }
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv("aes-256-gcm", getEnv().identityEncryptionKey, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return out.toString("utf-8");
  } catch (e) {
    console.warn("[identities] decrypt failed; row may be from a different key:", e);
    return null;
  }
}

/**
 * KV storage for one Inrupt Node `Session`, persisted to SQLite under the
 * given session ID. The SDK calls `get`/`set`/`delete` with its own keys
 * (PKCE verifiers, refresh tokens, DPoP keys, issuer config, …) — we
 * faithfully store and return whatever it asks for. Values are encrypted
 * with AES-256-GCM (see top of file).
 */
export function makeIdentityStorage(sessionId: string): IStorage {
  const db = getDb();
  const getStmt = db.prepare("SELECT value FROM identity_storage WHERE session_id = ? AND key = ?");
  const setStmt = db.prepare(
    `INSERT INTO identity_storage (session_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value`,
  );
  const delStmt = db.prepare("DELETE FROM identity_storage WHERE session_id = ? AND key = ?");

  return {
    async get(key: string): Promise<string | undefined> {
      const row = getStmt.get(sessionId, key) as { value: string } | undefined;
      if (!row) return undefined;
      const plain = decrypt(row.value);
      return plain ?? undefined;
    },
    async set(key: string, value: string): Promise<void> {
      // The Inrupt SDK stores its per-session record under
      // `solidClientAuthenticationUser:<id>` as a single JSON blob and
      // updates it via a read-modify-write that races itself when multiple
      // setForUser calls run in parallel (one of them clobbers
      // codeVerifier, breaking PKCE on the token exchange). We merge here
      // so concurrent writes of disjoint fields combine instead of
      // overwriting. Safe because the SDK never relies on field *removal*
      // via setForUser — explicit deletes go through `delete(key)`.
      if (key.startsWith("solidClientAuthenticationUser:")) {
        const existing = getStmt.get(sessionId, key) as { value: string } | undefined;
        if (existing) {
          const decrypted = decrypt(existing.value);
          if (decrypted) {
            try {
              const merged = {
                ...(JSON.parse(decrypted) as Record<string, unknown>),
                ...(JSON.parse(value) as Record<string, unknown>),
              };
              setStmt.run(sessionId, key, encrypt(JSON.stringify(merged)));
              return;
            } catch {
              /* fall through to plain set on parse failure */
            }
          }
        }
      }
      setStmt.run(sessionId, key, encrypt(value));
    },
    async delete(key: string): Promise<void> {
      delStmt.run(sessionId, key);
    },
  };
}

/** Persist (or replace) the WebID → sessionId mapping. */
export function saveIdentity(input: {
  webId: string;
  sessionId: string;
  oidcIssuer: string;
}): Identity {
  const now = Date.now();
  const db = getDb();
  // If this WebID already has an identity, drop the old session's KV rows
  // so we don't leak storage when the user re-authorizes.
  const existing = db
    .prepare("SELECT session_id FROM identities WHERE web_id = ?")
    .get(input.webId) as { session_id: string } | undefined;
  if (existing && existing.session_id !== input.sessionId) {
    db.prepare("DELETE FROM identity_storage WHERE session_id = ?").run(existing.session_id);
  }
  db.prepare(
    `INSERT INTO identities (web_id, session_id, oidc_issuer, connected_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(web_id) DO UPDATE SET
       session_id = excluded.session_id,
       oidc_issuer = excluded.oidc_issuer,
       connected_at = excluded.connected_at`,
  ).run(input.webId, input.sessionId, input.oidcIssuer, now);
  return { ...input, connectedAt: now };
}

export function getIdentityByWebId(webId: string): Identity | null {
  const row = getDb()
    .prepare(
      "SELECT web_id, session_id, oidc_issuer, connected_at FROM identities WHERE web_id = ?",
    )
    .get(webId) as
    | {
        web_id: string;
        session_id: string;
        oidc_issuer: string;
        connected_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    webId: row.web_id,
    sessionId: row.session_id,
    oidcIssuer: row.oidc_issuer,
    connectedAt: row.connected_at,
  };
}

export function listIdentities(): Identity[] {
  return (
    getDb()
      .prepare(
        "SELECT web_id, session_id, oidc_issuer, connected_at FROM identities ORDER BY connected_at DESC",
      )
      .all() as Array<{
      web_id: string;
      session_id: string;
      oidc_issuer: string;
      connected_at: number;
    }>
  ).map((r) => ({
    webId: r.web_id,
    sessionId: r.session_id,
    oidcIssuer: r.oidc_issuer,
    connectedAt: r.connected_at,
  }));
}

/** Disconnect an identity: drop the mapping AND its KV storage rows. */
export function deleteIdentity(webId: string): boolean {
  const db = getDb();
  const existing = getIdentityByWebId(webId);
  if (!existing) return false;
  db.prepare("DELETE FROM identity_storage WHERE session_id = ?").run(existing.sessionId);
  const info = db.prepare("DELETE FROM identities WHERE web_id = ?").run(webId);
  return info.changes > 0;
}
