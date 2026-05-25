import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Per-user / per-repo quotas (§4 multi-user). The defaults are env-
// driven; we lower them here so the test doesn't have to create 50
// repos to observe the limit.

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
  (process.env as Record<string, string>).MAX_REPOS_PER_OWNER = "2";
  (process.env as Record<string, string>).MAX_TOKENS_PER_REPO = "2";
});

describe("quotas", () => {
  it("refuses repo creation past MAX_REPOS_PER_OWNER", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { assertCanCreateRepo, QuotaExceededError } = await import(
      "@/lib/registry/quotas"
    );
    const owner = "quotatest";
    const baseInput = {
      owner,
      ownerWebId: "http://example.com/quota#me",
      ownerPodRoot: "http://example.com/quota/",
    };

    assertCanCreateRepo(owner);
    createRepo({ ...baseInput, name: "a" });
    assertCanCreateRepo(owner);
    createRepo({ ...baseInput, name: "b" });
    expect(() => assertCanCreateRepo(owner)).toThrow(QuotaExceededError);
  });

  it("refuses token mint past MAX_TOKENS_PER_REPO", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { createPushToken } = await import("@/lib/registry/tokens");
    const { assertCanMintToken, QuotaExceededError } = await import(
      "@/lib/registry/quotas"
    );
    const repo = createRepo({
      owner: "quotatokens",
      name: "tk",
      ownerWebId: "http://example.com/qt#me",
      ownerPodRoot: "http://example.com/qt/",
    });
    assertCanMintToken(repo.id);
    createPushToken(repo.id, "a");
    assertCanMintToken(repo.id);
    createPushToken(repo.id, "b");
    expect(() => assertCanMintToken(repo.id)).toThrow(QuotaExceededError);
  });
});
