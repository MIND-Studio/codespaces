import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Ephemeral OCI blob-upload sessions (docs/PACKAGES-PLAN.md → OCI phase).
 *
 * The Distribution Spec's chunked-upload flow (POST → PATCH* → PUT) needs
 * server-side state between requests to accumulate chunks. The bridge runs as
 * a long-lived Node process, so a module-global Map survives across requests
 * (same pattern as the SQLite handle). Sessions are in-memory only: a process
 * restart drops them and the client just re-pushes — acceptable, since the CAS
 * makes re-pushes idempotent.
 *
 * Chunks accumulate in memory, so total upload size is capped by the caller
 * (MAX_PACKAGE_BLOB_BYTES). Streaming straight to the pod is the documented
 * follow-up that lifts the large-layer ceiling.
 */

type Session = { chunks: Uint8Array[]; size: number };

const GLOBAL_KEY = "__mc_oci_uploads__";

declare global {
  // eslint-disable-next-line no-var
  var __mc_oci_uploads__: Map<string, Session> | undefined;
}

function sessions(): Map<string, Session> {
  return (globalThis[GLOBAL_KEY] ??= new Map());
}

export function startUpload(): string {
  const uuid = randomUUID();
  sessions().set(uuid, { chunks: [], size: 0 });
  return uuid;
}

/** Append a chunk. Returns the new total size, or null if the session is unknown. */
export function appendChunk(uuid: string, bytes: Uint8Array): number | null {
  const s = sessions().get(uuid);
  if (!s) return null;
  s.chunks.push(bytes);
  s.size += bytes.byteLength;
  return s.size;
}

export function uploadSize(uuid: string): number | null {
  return sessions().get(uuid)?.size ?? null;
}

/**
 * Finalize: append the optional trailing `bytes` (from the closing PUT), then
 * concatenate everything and drop the session. Returns null if unknown.
 */
export function finishUpload(uuid: string, bytes?: Uint8Array): Uint8Array | null {
  const s = sessions().get(uuid);
  if (!s) return null;
  if (bytes && bytes.byteLength > 0) {
    s.chunks.push(bytes);
    s.size += bytes.byteLength;
  }
  const out = new Uint8Array(s.size);
  let offset = 0;
  for (const chunk of s.chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  sessions().delete(uuid);
  return out;
}

export function abortUpload(uuid: string): void {
  sessions().delete(uuid);
}
