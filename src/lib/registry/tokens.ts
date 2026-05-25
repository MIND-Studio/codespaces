import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { getDb } from "@/lib/registry/db";

const TOKEN_PREFIX = "scp_";
const TOKEN_BODY_BYTES = 24; // 24 bytes → 32 base64url chars

export type PushTokenSummary = {
  id: number;
  label: string;
  createdAt: number;
};

/**
 * Mint a fresh push token for a repo. The plaintext is returned ONCE in
 * the response and never stored — only its sha256 hash lives in the
 * database. Lose the plaintext, lose the token; create a new one.
 */
export function createPushToken(
  repoId: number,
  label: string,
): { token: string; id: number; label: string; createdAt: number } {
  const body = randomBytes(TOKEN_BODY_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${body}`;
  const hash = sha256(token);
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO push_tokens (repo_id, token_hash, label, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(repoId, hash, label, now);
  return {
    token,
    id: info.lastInsertRowid as number,
    label,
    createdAt: now,
  };
}

export function listPushTokens(repoId: number): PushTokenSummary[] {
  return (
    getDb()
      .prepare(
        `SELECT id, label, created_at FROM push_tokens
         WHERE repo_id = ? ORDER BY created_at DESC`,
      )
      .all(repoId) as Array<{ id: number; label: string; created_at: number }>
  ).map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
}

export function revokePushToken(repoId: number, id: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM push_tokens WHERE id = ? AND repo_id = ?")
    .run(id, repoId);
  return info.changes > 0;
}

/**
 * Verify a presented plaintext token against the stored hashes for a
 * repo. Constant-time-ish at the SQL layer (single point lookup by
 * exact hash equality).
 */
export function verifyPushToken(repoId: number, plaintext: string): boolean {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return false;
  const hash = sha256(plaintext);
  const row = getDb()
    .prepare(
      "SELECT 1 AS ok FROM push_tokens WHERE repo_id = ? AND token_hash = ?",
    )
    .get(repoId, hash);
  return row !== undefined;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}
