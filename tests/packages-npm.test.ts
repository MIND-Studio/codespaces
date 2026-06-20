import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// npm protocol helpers. Verifies:
//   • parseNpmPublish pulls the single version + base64 tarball out of a
//     real-shaped publish body
//   • buildPackument rewrites each version's dist.tarball to a bridge URL,
//     preserves the client-computed integrity, and resolves dist-tags.latest
//   • findVersionByFilename maps a tarball filename back to its row

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-pkg-npm-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("npm protocol", () => {
  it("parses an npm publish body", async () => {
    const { parseNpmPublish } = await import("@/lib/packages/npm");

    const tarball = Buffer.from("fake-tgz-bytes");
    const body = {
      _id: "@alice/lib",
      name: "@alice/lib",
      "dist-tags": { latest: "1.2.3" },
      versions: {
        "1.2.3": {
          name: "@alice/lib",
          version: "1.2.3",
          dist: { shasum: "deadbeef", integrity: "sha512-abc==" },
        },
      },
      _attachments: {
        "lib-1.2.3.tgz": {
          content_type: "application/octet-stream",
          data: tarball.toString("base64"),
          length: tarball.length,
        },
      },
    };

    const parsed = parseNpmPublish(body);
    expect(parsed.name).toBe("@alice/lib");
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.tarballFilename).toBe("lib-1.2.3.tgz");
    expect(Buffer.from(parsed.tarballBytes).toString("utf-8")).toBe("fake-tgz-bytes");
    expect(parsed.distTags.latest).toBe("1.2.3");
  });

  it("rejects malformed publish bodies", async () => {
    const { parseNpmPublish, NpmPublishError } = await import("@/lib/packages/npm");
    expect(() => parseNpmPublish({ name: "" } as never)).toThrow(NpmPublishError);
    expect(() => parseNpmPublish({ name: "x", versions: {}, _attachments: {} } as never)).toThrow(
      NpmPublishError,
    );
  });

  it("builds a packument with rewritten tarball URLs and latest tag", async () => {
    const { buildPackument, findVersionByFilename } = await import("@/lib/packages/npm");
    const now = 1_000;
    const rows = [
      // newest-first, as listVersions returns
      {
        id: 2,
        repoId: 1,
        type: "npm" as const,
        name: "@alice/lib",
        version: "1.1.0",
        digest: "sha256:bbb",
        sizeBytes: 20,
        contentType: "application/octet-stream",
        metadata: {
          manifest: {
            name: "@alice/lib",
            version: "1.1.0",
            dist: { shasum: "beef", integrity: "sha512-v11==" },
          },
          filename: "lib-1.1.0.tgz",
          distTags: { latest: "1.1.0" },
        },
        createdAt: now + 10,
      },
      {
        id: 1,
        repoId: 1,
        type: "npm" as const,
        name: "@alice/lib",
        version: "1.0.0",
        digest: "sha256:aaa",
        sizeBytes: 10,
        contentType: "application/octet-stream",
        metadata: {
          manifest: {
            name: "@alice/lib",
            version: "1.0.0",
            dist: { shasum: "f00d", integrity: "sha512-v10==" },
          },
          filename: "lib-1.0.0.tgz",
          distTags: { latest: "1.0.0" },
        },
        createdAt: now,
      },
    ];

    const base = "https://bridge.example/api/packages/npm/alice/mylib";
    const packument = buildPackument("@alice/lib", rows, base);

    expect(packument.name).toBe("@alice/lib");
    expect(Object.keys(packument.versions).sort()).toEqual(["1.0.0", "1.1.0"]);
    expect(packument.versions["1.1.0"].dist?.tarball).toBe(
      "https://bridge.example/api/packages/npm/alice/mylib/@alice/lib/-/lib-1.1.0.tgz",
    );
    // Client-computed integrity is preserved.
    expect(packument.versions["1.0.0"].dist?.integrity).toBe("sha512-v10==");
    // Latest = newest version that tagged itself latest.
    expect(packument["dist-tags"].latest).toBe("1.1.0");

    // Filename → row reverse lookup.
    expect(findVersionByFilename(rows, "lib-1.0.0.tgz")?.version).toBe("1.0.0");
    expect(findVersionByFilename(rows, "nope.tgz")).toBeNull();
  });
});
