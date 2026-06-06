import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * MC-150 regression: "Bridge restart drops pod auth → re-connect loop."
 *
 * The root cause the issue feared was *in-memory* DPoP state: if the DPoP
 * keypair lived only in the process, a bridge restart would lose it and the
 * (non-rotating) pod refresh token could never be reused — every pod write
 * would 401 and the UI would loop on "re-connect."
 *
 * Why that no longer holds: the Inrupt node SDK persists the per-session
 * record — including the DPoP `publicKey`/`privateKey` and the `refreshToken`
 * — through whatever `IStorage` we hand it, and reads them back on refresh
 * (`getSessionFromStorage` → `storageUtility.getForUser(sessionId,
 * "publicKey"/"privateKey"/"refreshToken")`, see
 * `@inrupt/solid-client-authn-node/dist/index.js` ~L526/L640). Our `IStorage`
 * is the AES-256-GCM-encrypted, SQLite-backed `makeIdentityStorage`, and
 * `getOwnerFetch` reloads from it on *every* call (no in-memory authed-fetch
 * cache). So after a process restart the refresh material is still on disk and
 * the next pod write rehydrates and refreshes — arm 1 of the acceptance
 * criteria.
 *
 * This test pins that mechanism: it writes the SDK's session blob through the
 * storage, simulates a restart by dropping the cached DB handle
 * (`closeDb()`), then re-opens a *fresh* storage instance over the same
 * on-disk DB and asserts the DPoP keypair + refresh token survive (and
 * decrypt). A future "keep the keypair in memory for speed" regression would
 * fail here. (Arm 2 — a failed refresh degrades to a single `/connect` prompt
 * rather than a loop — is covered by tests/oidc-refresh-normalize.test.ts and
 * tests/fetch-for-owner.test.ts under MC-173.)
 */

const SESSION_ID = "sess-restart-150";
// The SDK reads these fields out of the single
// `solidClientAuthenticationUser:<sessionId>` JSON record via getForUser.
const STORAGE_KEY = `solidClientAuthenticationUser:${SESSION_ID}`;

// A representative session record as the SDK would persist it after a
// successful authorization-code exchange: DPoP-bound, with a refresh token
// and a serialized keypair.
const SESSION_RECORD = {
  isLoggedIn: "true",
  webId: "http://localhost:3011/alice/profile/card#me",
  issuer: "http://localhost:3011/",
  dpop: "true",
  refreshToken: "rt_non_rotating_pod_refresh_token",
  clientId: "client-abc",
  publicKey: JSON.stringify({ kty: "EC", crv: "P-256", x: "xxx", y: "yyy" }),
  privateKey: JSON.stringify({
    kty: "EC",
    crv: "P-256",
    x: "xxx",
    y: "yyy",
    d: "the-secret-scalar",
  }),
};

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-restart-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
  // Fix the encryption key so encrypt-on-write and decrypt-on-read use the
  // same key across the simulated restart (a real bridge gets it from env/KMS
  // at boot — stable across restarts by design, P0-S4).
  (process.env as Record<string, string>).IDENTITY_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef";
});

describe("identity storage survives a bridge restart (MC-150)", () => {
  it("rehydrates the DPoP keypair + refresh token from SQLite after closeDb()", async () => {
    const { makeIdentityStorage } = await import("@/lib/registry/identities");
    const { closeDb } = await import("@/lib/registry/db");

    // --- before restart: the SDK persists the session record through us.
    const before = makeIdentityStorage(SESSION_ID);
    await before.set(STORAGE_KEY, JSON.stringify(SESSION_RECORD));

    // The value must NOT be stored as plaintext (AES-256-GCM envelope).
    const { getDb } = await import("@/lib/registry/db");
    const raw = (
      getDb()
        .prepare(
          "SELECT value FROM identity_storage WHERE session_id = ? AND key = ?",
        )
        .get(SESSION_ID, STORAGE_KEY) as { value: string }
    ).value;
    expect(raw.startsWith("v1:")).toBe(true);
    expect(raw).not.toContain("the-secret-scalar");

    // --- simulate the bridge restarting: drop the in-process DB handle so the
    // next getDb() re-opens the same on-disk file from cold.
    closeDb();

    // --- after restart: a fresh storage instance reads the material back.
    const after = makeIdentityStorage(SESSION_ID);
    const rehydrated = await after.get(STORAGE_KEY);
    expect(rehydrated).toBeTypeOf("string");
    const record = JSON.parse(rehydrated as string);

    // The three things the SDK's refresh grant needs are all present.
    expect(record.refreshToken).toBe(SESSION_RECORD.refreshToken);
    expect(record.publicKey).toBe(SESSION_RECORD.publicKey);
    expect(record.privateKey).toBe(SESSION_RECORD.privateKey);
    expect(record.dpop).toBe("true");
    expect(record.isLoggedIn).toBe("true");
  });

  it("a field-merge write (the SDK's read-modify-write) preserves the keypair across restart", async () => {
    const { makeIdentityStorage } = await import("@/lib/registry/identities");
    const { closeDb } = await import("@/lib/registry/db");

    const sid = "sess-restart-150-merge";
    const key = `solidClientAuthenticationUser:${sid}`;
    const store = makeIdentityStorage(sid);

    // First write lays down the keypair…
    await store.set(
      key,
      JSON.stringify({
        publicKey: SESSION_RECORD.publicKey,
        privateKey: SESSION_RECORD.privateKey,
        dpop: "true",
      }),
    );
    // …a later disjoint write (e.g. a rotated refresh token) must MERGE, not
    // clobber the keypair (the identities IStorage merges this special key).
    await store.set(
      key,
      JSON.stringify({ refreshToken: "rt_rotated", isLoggedIn: "true" }),
    );

    closeDb();

    const record = JSON.parse(
      (await makeIdentityStorage(sid).get(key)) as string,
    );
    expect(record.privateKey).toBe(SESSION_RECORD.privateKey);
    expect(record.refreshToken).toBe("rt_rotated");
    expect(record.dpop).toBe("true");
  });
});
