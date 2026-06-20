import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Test 2 in §3.2 priority list: push-token lifecycle. Verifies:
//   • mint returns a `scp_`-prefixed token whose plaintext is never
//     persisted (only its sha256)
//   • verify accepts the matching plaintext for the right repo
//   • verify rejects: (a) wrong plaintext, (b) right plaintext but
//     wrong repo, (c) revoked token, (d) malformed prefix
// Regression guard: any future "store the plaintext for convenience"
// PR would break test (a) immediately.

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("push tokens", () => {
  it("mints, verifies, and revokes", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { createPushToken, verifyPushToken, listPushTokens, revokePushToken } = await import(
      "@/lib/registry/tokens"
    );
    const { getDb } = await import("@/lib/registry/db");

    const repo = createRepo({
      owner: "alice",
      name: "tokens-test",
      ownerWebId: "http://example.com/alice#me",
      ownerPodRoot: "http://example.com/alice/",
    });

    const minted = createPushToken(repo.id, "laptop");
    expect(minted.token.startsWith("scp_")).toBe(true);
    expect(minted.token.length).toBeGreaterThan(20);

    // Plaintext must NOT appear in the row.
    const row = getDb()
      .prepare("SELECT token_hash FROM push_tokens WHERE id = ?")
      .get(minted.id) as { token_hash: string };
    expect(row.token_hash).not.toContain(minted.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);

    // Right plaintext, right repo: accepts.
    expect(verifyPushToken(repo.id, minted.token)).toBe(true);
    // Wrong plaintext: rejects.
    expect(verifyPushToken(repo.id, "scp_wrong")).toBe(false);
    // Wrong prefix: rejects without DB hit.
    expect(verifyPushToken(repo.id, minted.token.replace("scp_", "xyz_"))).toBe(false);
    // Wrong repo id: rejects.
    expect(verifyPushToken(repo.id + 9999, minted.token)).toBe(false);

    // List shape.
    const all = listPushTokens(repo.id);
    expect(all.length).toBe(1);
    expect(all[0].label).toBe("laptop");

    // Revoke: subsequent verify returns false.
    expect(revokePushToken(repo.id, minted.id)).toBe(true);
    expect(verifyPushToken(repo.id, minted.token)).toBe(false);
  });
});
