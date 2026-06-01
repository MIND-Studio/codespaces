import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The packages index. Verifies:
//   • upsert inserts, and re-upserting the same (repo,type,name,version)
//     replaces the row (repoints digest) rather than duplicating
//   • lookups by version, by name, and the repo-wide list
//   • name/version validation rejects traversal and bad characters
//   • the per-repo storage quota sums published blob sizes

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-pkg-store-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("packages index", () => {
  it("upserts, replaces, lists, and validates", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const {
      upsertPackageVersion,
      getPackageVersion,
      listVersions,
      listPackages,
      validatePackageName,
      validateVersion,
      PackageError,
    } = await import("@/lib/packages/store");

    const repo = createRepo({
      owner: "alice",
      name: "pkg-store-test",
      ownerWebId: "http://example.com/alice#me",
      ownerPodRoot: "http://example.com/alice/",
    });

    upsertPackageVersion({
      repoId: repo.id,
      type: "npm",
      name: "@alice/lib",
      version: "1.0.0",
      digest: "sha256:aaa",
      sizeBytes: 100,
      contentType: "application/octet-stream",
      metadata: { filename: "lib-1.0.0.tgz" },
    });

    const v = getPackageVersion(repo.id, "npm", "@alice/lib", "1.0.0");
    expect(v?.digest).toBe("sha256:aaa");
    expect(v?.metadata?.filename).toBe("lib-1.0.0.tgz");

    // Re-publishing the same version replaces, not duplicates.
    upsertPackageVersion({
      repoId: repo.id,
      type: "npm",
      name: "@alice/lib",
      version: "1.0.0",
      digest: "sha256:bbb",
      sizeBytes: 200,
    });
    const versions = listVersions(repo.id, "npm", "@alice/lib");
    expect(versions.length).toBe(1);
    expect(versions[0].digest).toBe("sha256:bbb");

    // A second version + a file artifact.
    upsertPackageVersion({
      repoId: repo.id,
      type: "npm",
      name: "@alice/lib",
      version: "1.1.0",
      digest: "sha256:ccc",
      sizeBytes: 50,
    });
    upsertPackageVersion({
      repoId: repo.id,
      type: "file",
      name: "release.zip",
      version: "2024-01",
      digest: "sha256:ddd",
      sizeBytes: 10,
    });

    expect(listVersions(repo.id, "npm", "@alice/lib").length).toBe(2);
    expect(listPackages(repo.id).length).toBe(3);
    expect(listPackages(repo.id, "file").length).toBe(1);

    // Validation.
    expect(() => validatePackageName("../etc/passwd", "file")).toThrow(PackageError);
    expect(() => validatePackageName("@scope/ok", "npm")).not.toThrow();
    expect(() => validateVersion("1.0.0")).not.toThrow();
    expect(() => validateVersion("../../x")).toThrow(PackageError);
  });

  it("sums per-repo package bytes for the quota", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { upsertPackageVersion } = await import("@/lib/packages/store");
    const { sumPackageBytesForRepo, assertCanStorePackage, QuotaExceededError } =
      await import("@/lib/registry/quotas");

    const repo = createRepo({
      owner: "alice",
      name: "pkg-quota-test",
      ownerWebId: "http://example.com/alice#me",
      ownerPodRoot: "http://example.com/alice/",
    });

    upsertPackageVersion({
      repoId: repo.id,
      type: "file",
      name: "a.bin",
      version: "1",
      digest: "sha256:e1",
      sizeBytes: 1024,
    });
    upsertPackageVersion({
      repoId: repo.id,
      type: "file",
      name: "b.bin",
      version: "1",
      digest: "sha256:e2",
      sizeBytes: 2048,
    });
    expect(sumPackageBytesForRepo(repo.id)).toBe(3072);

    // A blob larger than the single-blob cap (default 100 MiB) is refused.
    expect(() => assertCanStorePackage(repo.id, 1)).not.toThrow();
    expect(() => assertCanStorePackage(repo.id, 500 * 1024 * 1024)).toThrow(
      QuotaExceededError,
    );
  });
});
