import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Issue #175 — oversize OCI blob uploads must be rejected with a 413 *before*
// the body is buffered into memory (the bridge buffers each blob in RAM, so an
// over-cap layer would OOM the process during req.arrayBuffer()). We pin a tiny
// MAX_PACKAGE_BLOB_BYTES and assert the route 413s on a body that exceeds it.
//
// The cap is read once at quotas import, so it must be set before any import
// that pulls in the quotas module (the route does, transitively).
beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-pkg-blobcap-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).NODE_ENV = "development";
  (process.env as Record<string, string>).MAX_PACKAGE_BLOB_BYTES = "1024"; // 1 KiB
});

function basicAuth(token: string): string {
  return "Basic " + Buffer.from(`me:${token}`).toString("base64");
}

describe("OCI blob upload size cap (#175)", () => {
  it("rejects oversize uploads with 413 before buffering, accepts small ones", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { createPushToken } = await import("@/lib/registry/tokens");
    const { startUpload } = await import("@/lib/packages/oci-uploads");
    const { POST, PATCH } = await import("@/app/v2/[[...path]]/route");

    const repo = createRepo({
      owner: "alice",
      name: "blobcap",
      ownerWebId: "http://example.com/alice#me",
      ownerPodRoot: "http://example.com/alice/",
    });
    const { token } = createPushToken(repo.id, "test");
    const auth = basicAuth(token);
    const over = new Uint8Array(2048); // 2 KiB > 1 KiB cap
    const under = new Uint8Array(512); // 512 B < 1 KiB cap

    // PATCH (append a chunk) — oversize chunk → 413, no OOM.
    const uuid = startUpload();
    const patchReq = new Request(
      `http://localhost/v2/alice/blobcap/blobs/uploads/${uuid}`,
      { method: "PATCH", headers: { authorization: auth }, body: over },
    );
    const patchRes = await PATCH(patchReq, {
      params: Promise.resolve({ path: ["alice", "blobcap", "blobs", "uploads", uuid] }),
    });
    expect(patchRes.status).toBe(413);

    // POST (monolithic single-shot) — oversize body → 413.
    const postReq = new Request(
      "http://localhost/v2/alice/blobcap/blobs/uploads?digest=sha256:deadbeef",
      { method: "POST", headers: { authorization: auth }, body: over },
    );
    const postRes = await POST(postReq, {
      params: Promise.resolve({ path: ["alice", "blobcap", "blobs", "uploads"] }),
    });
    expect(postRes.status).toBe(413);

    // A small chunk under the cap is NOT rejected by the guard (202 accepted).
    const okUuid = startUpload();
    const okReq = new Request(
      `http://localhost/v2/alice/blobcap/blobs/uploads/${okUuid}`,
      { method: "PATCH", headers: { authorization: auth }, body: under },
    );
    const okRes = await PATCH(okReq, {
      params: Promise.resolve({ path: ["alice", "blobcap", "blobs", "uploads", okUuid] }),
    });
    expect(okRes.status).toBe(202);
  });
});
