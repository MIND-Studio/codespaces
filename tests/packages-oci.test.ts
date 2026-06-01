import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OCI Distribution Spec routing + upload sessions. Verifies:
//   • parseOciRequest classifies each /v2 endpoint and splits owner/repo/image
//   • digest-form references validate; tags validate; traversal rejected
//   • the in-memory upload session accumulates chunks and concatenates them

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-pkg-oci-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("OCI routing", () => {
  it("classifies /v2 requests", async () => {
    const { parseOciRequest } = await import("@/lib/packages/oci");

    expect(parseOciRequest([]).kind).toBe("version");
    expect(parseOciRequest(undefined).kind).toBe("version");

    const m = parseOciRequest(["alice", "repo", "manifests", "v1"]);
    expect(m.kind).toBe("manifest");
    if (m.kind === "manifest") {
      expect(m.name.owner).toBe("alice");
      expect(m.name.repo).toBe("repo");
      expect(m.name.image).toBe("repo"); // defaults to repo
      expect(m.reference).toBe("v1");
    }

    // Nested image name: owner/repo/<image>
    const m2 = parseOciRequest(["alice", "repo", "web", "manifests", "sha256:abc"]);
    expect(m2.kind).toBe("manifest");
    if (m2.kind === "manifest") {
      expect(m2.name.image).toBe("web");
      expect(m2.name.name).toBe("alice/repo/web");
      expect(m2.reference).toBe("sha256:abc");
    }

    const b = parseOciRequest(["alice", "repo", "blobs", "sha256:deadbeef"]);
    expect(b.kind).toBe("blob");
    if (b.kind === "blob") expect(b.digest).toBe("sha256:deadbeef");

    expect(parseOciRequest(["alice", "repo", "blobs", "uploads"]).kind).toBe(
      "upload-start",
    );

    const u = parseOciRequest(["alice", "repo", "blobs", "uploads", "uuid-123"]);
    expect(u.kind).toBe("upload-session");
    if (u.kind === "upload-session") expect(u.uuid).toBe("uuid-123");

    expect(parseOciRequest(["alice", "repo", "tags", "list"]).kind).toBe("tags");

    // Too few name segments before the keyword → unknown.
    expect(parseOciRequest(["alice", "manifests", "v1"]).kind).toBe("unknown");
  });

  it("validates references and image names", async () => {
    const { validateVersion, validatePackageName, isDigestRef, PackageError } =
      await import("@/lib/packages/store");

    expect(isDigestRef("sha256:" + "a".repeat(64))).toBe(true);
    expect(isDigestRef("v1.2.3")).toBe(false);

    expect(() => validateVersion("sha256:" + "a".repeat(64))).not.toThrow();
    expect(() => validateVersion("v1.0.0")).not.toThrow();
    expect(() => validateVersion("../etc")).toThrow(PackageError);

    expect(() => validatePackageName("team/service", "oci")).not.toThrow();
    expect(() => validatePackageName("myimage", "oci")).not.toThrow();
    expect(() => validatePackageName("Bad_UPPER", "oci")).toThrow(PackageError);
    expect(() => validatePackageName("../evil", "oci")).toThrow(PackageError);
  });

  it("accumulates upload chunks and concatenates on finish", async () => {
    const { startUpload, appendChunk, finishUpload, uploadSize } = await import(
      "@/lib/packages/oci-uploads"
    );

    const uuid = startUpload();
    expect(appendChunk(uuid, new Uint8Array([1, 2, 3]))).toBe(3);
    expect(appendChunk(uuid, new Uint8Array([4, 5]))).toBe(5);
    expect(uploadSize(uuid)).toBe(5);

    // The closing PUT can carry a final chunk.
    const full = finishUpload(uuid, new Uint8Array([6]));
    expect(full).not.toBeNull();
    expect(Array.from(full!)).toEqual([1, 2, 3, 4, 5, 6]);

    // Session is gone after finish.
    expect(uploadSize(uuid)).toBeNull();
    expect(appendChunk(uuid, new Uint8Array([9]))).toBeNull();
    expect(finishUpload("never-existed")).toBeNull();
  });
});
