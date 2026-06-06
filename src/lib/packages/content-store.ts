import "server-only";
import { createHash } from "node:crypto";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import { log } from "@/lib/log";

/**
 * Content-addressed blob store backed by a Solid pod (see
 * docs/PACKAGES-PLAN.md → "Storage: PodContentStore").
 *
 * Every blob is keyed by the sha256 of its bytes and lands at a fanned-out
 * path under the owner's `public/` container:
 *
 *   {podRoot}public/packages/blobs/sha256/<aa>/<full-hex>
 *
 * Keeping the CAS under `public/` means the artifacts are independently
 * readable by any Solid app pointed at the pod — the whole point of "bytes
 * live in the pod". Because the store is content-addressed, writes are
 * idempotent (HEAD-before-PUT) and identical bytes dedup for free.
 *
 * This module is format-agnostic — npm tarballs, generic files, and (later)
 * OCI layer blobs all flow through the same `save`/`has`/`open`. The caller
 * supplies the authenticated `fetch`: a delegated/seeded owner fetch for
 * writes, or a plain unauthenticated fetch for reads (the blobs are
 * public-read).
 */

const BLOB_SEGMENTS = ["public", "packages", "blobs", "sha256"] as const;

export type BlobRef = { digest: string; size: number };

export class PodContentStore {
  private readonly root: string;

  constructor(
    private readonly opts: {
      podRoot: string;
      ownerWebId: string;
      fetch: typeof fetch;
    },
  ) {
    this.root = opts.podRoot.endsWith("/") ? opts.podRoot : opts.podRoot + "/";
  }

  /** Pod URL for a given sha256 hex digest (no `sha256:` prefix). */
  blobUrl(hex: string): string {
    return `${this.root}${BLOB_SEGMENTS.join("/")}/${hex.slice(0, 2)}/${hex}`;
  }

  /**
   * Store `bytes`, returning its `sha256:<hex>` digest and size. No-op write
   * if the blob already exists (content-addressed → same bytes, same path).
   */
  async save(bytes: Uint8Array): Promise<BlobRef> {
    const hex = createHash("sha256").update(bytes).digest("hex");
    const digest = `sha256:${hex}`;
    const size = bytes.byteLength;

    if (await this.has(digest)) return { digest, size };

    await this.ensureBlobPath(hex);
    const res = await this.opts.fetch(this.blobUrl(hex), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes) as unknown as BodyInit,
    });
    // 409 == already created by a racing writer; harmless for a CAS.
    if (!res.ok && res.status !== 409) {
      throw new Error(
        `content-store PUT ${this.blobUrl(hex)} failed: ${res.status} ${res.statusText}`,
      );
    }
    return { digest, size };
  }

  async has(digest: string): Promise<boolean> {
    const res = await this.opts.fetch(this.blobUrl(stripSha(digest)), {
      method: "HEAD",
    });
    return res.ok;
  }

  /**
   * Read a blob's bytes, or null if it's gone (404).
   *
   * The CAS lives under the owner's `public/` container, so the bytes can be
   * mutated out-of-band by any pod app (or corrupted in transit). Being
   * content-addressed, integrity is checkable for free: we re-hash what came
   * back and **refuse to serve** (throw + log a `security` warning) anything
   * whose digest doesn't match the one requested. A swapped or corrupted blob
   * must never round-trip as authentic.
   */
  async open(digest: string): Promise<Uint8Array | null> {
    const want = stripSha(digest).toLowerCase();
    const res = await this.opts.fetch(this.blobUrl(want), {
      method: "GET",
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `content-store GET ${this.blobUrl(want)} failed: ${res.status}`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== want) {
      log.warn("content-store blob digest mismatch — refusing to serve", {
        security: true,
        url: this.blobUrl(want),
        requested: `sha256:${want}`,
        actual: `sha256:${got}`,
        size: bytes.byteLength,
      });
      throw new Error(
        `content-store integrity check failed for ${this.blobUrl(want)}: requested sha256:${want}, got sha256:${got}`,
      );
    }
    return bytes;
  }

  /**
   * Walk from the pod root down to the blob's fan-out container, creating
   * each intermediate container. Sets a public-read default ACL on the
   * top-level `public/` so the CAS is world-readable (mirrors how the Pages
   * publisher treats `public/`).
   */
  private async ensureBlobPath(hex: string): Promise<void> {
    const segments = [...BLOB_SEGMENTS, hex.slice(0, 2)];
    let cursor = this.root;
    for (let i = 0; i < segments.length; i++) {
      cursor = `${cursor}${segments[i]}/`;
      await ensureContainer(this.opts.fetch, cursor);
      if (i === 0 && segments[i] === "public") {
        await setPublicReadAcl(this.opts.fetch, cursor, this.opts.ownerWebId);
      }
    }
  }
}

function stripSha(digest: string): string {
  return digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
}
