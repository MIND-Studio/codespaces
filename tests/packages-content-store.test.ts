import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// PodContentStore against an in-memory fake pod. Verifies:
//   • save returns the sha256 of the bytes (content-addressed)
//   • the blob lands under public/packages/blobs/sha256/<aa>/<hex>
//   • has() is true after save, false before
//   • open() round-trips the exact bytes
//   • save() is idempotent — re-saving identical bytes is a no-op PUT
//   • the public/ container gets a public-read ACL on first write

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-pkg-cas-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).NODE_ENV = "development";
});

/** Minimal in-memory pod: a Map of URL → bytes that speaks HEAD/PUT/GET. */
function makeFakePod() {
  const store = new Map<string, Uint8Array>();
  let putCount = 0;
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return new Response(null, { status: store.has(u) ? 200 : 404 });
    }
    if (method === "PUT") {
      putCount += 1;
      const body = init?.body;
      // Containers are PUT with no body; blobs carry a Uint8Array body.
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(0);
      store.set(u, bytes);
      return new Response(null, { status: 201 });
    }
    if (method === "GET") {
      const b = store.get(u);
      if (!b) return new Response(null, { status: 404 });
      return new Response(b as unknown as BodyInit, { status: 200 });
    }
    return new Response(null, { status: 405 });
  }) as unknown as typeof fetch;
  return { store, fetcher, blobPuts: () => putCount };
}

describe("PodContentStore", () => {
  const podRoot = "http://pod.example/alice/";
  const ownerWebId = "http://pod.example/alice/profile/card#me";

  it("stores, addresses, and round-trips blobs", async () => {
    const { PodContentStore } = await import("@/lib/packages/content-store");
    const pod = makeFakePod();
    const store = new PodContentStore({ podRoot, ownerWebId, fetch: pod.fetcher });

    const bytes = new Uint8Array(Buffer.from("hello"));
    // sha256("hello") is a known constant.
    const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    expect(await store.has(`sha256:${HELLO_SHA}`)).toBe(false);

    const ref = await store.save(bytes);
    expect(ref.digest).toBe(`sha256:${HELLO_SHA}`);
    expect(ref.size).toBe(5);

    // Lands at the fanned-out CAS path under public/.
    const expectedUrl = `${podRoot}public/packages/blobs/sha256/${HELLO_SHA.slice(0, 2)}/${HELLO_SHA}`;
    expect(store.blobUrl(HELLO_SHA)).toBe(expectedUrl);
    expect(pod.store.has(expectedUrl)).toBe(true);

    // public/ got a public-read ACL.
    expect(pod.store.has(`${podRoot}public/.acl`)).toBe(true);

    expect(await store.has(ref.digest)).toBe(true);

    const read = await store.open(ref.digest);
    expect(read).not.toBeNull();
    expect(Buffer.from(read!).toString("utf-8")).toBe("hello");
  });

  it("is idempotent — identical bytes are not re-PUT", async () => {
    const { PodContentStore } = await import("@/lib/packages/content-store");
    const pod = makeFakePod();
    const store = new PodContentStore({ podRoot, ownerWebId, fetch: pod.fetcher });

    const bytes = new Uint8Array(Buffer.from("dedup me"));
    const first = await store.save(bytes);
    const putsAfterFirst = pod.blobPuts();
    const second = await store.save(bytes);

    expect(second.digest).toBe(first.digest);
    // The second save HEADs, finds the blob, and skips the PUT entirely.
    expect(pod.blobPuts()).toBe(putsAfterFirst);
  });

  it("open() returns null for a missing blob", async () => {
    const { PodContentStore } = await import("@/lib/packages/content-store");
    const pod = makeFakePod();
    const store = new PodContentStore({ podRoot, ownerWebId, fetch: pod.fetcher });
    const missing = await store.open("sha256:" + "0".repeat(64));
    expect(missing).toBeNull();
  });

  it("open() refuses to serve a blob whose bytes don't match the requested digest", async () => {
    const { PodContentStore } = await import("@/lib/packages/content-store");
    const pod = makeFakePod();
    const store = new PodContentStore({ podRoot, ownerWebId, fetch: pod.fetcher });

    // Save a blob, then corrupt the stored bytes in place at the SAME CAS path
    // (simulates a swapped/corrupted pod resource served under its digest URL).
    const ref = await store.save(new Uint8Array(Buffer.from("authentic")));
    const url = store.blobUrl(ref.digest.slice("sha256:".length));
    expect(pod.store.has(url)).toBe(true);
    pod.store.set(url, new Uint8Array(Buffer.from("tampered")));

    // Re-hash on read catches the mismatch: throw, never the bytes.
    await expect(store.open(ref.digest)).rejects.toThrow(/integrity check failed/);
  });
});
