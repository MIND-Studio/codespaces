import "server-only";

/**
 * OCI Distribution Spec routing (docs/PACKAGES-PLAN.md → OCI phase).
 *
 * Docker/OCI clients speak a fixed set of `/v2/...` endpoints. The image
 * `<name>` is everything in the path before the `manifests` / `blobs` /
 * `tags` keyword, and is itself a `/`-separated repository name. We map the
 * first two segments to (owner, repo) — matching the rest of the registry's
 * repo-scoping — and treat any remaining segments as the image name within
 * that repo (defaulting to the repo name).
 *
 *   /v2/                                   → version check
 *   /v2/<o>/<r>[/<img>]/manifests/<ref>    → manifest by tag or digest
 *   /v2/<o>/<r>[/<img>]/blobs/<digest>     → blob by digest
 *   /v2/<o>/<r>[/<img>]/blobs/uploads/     → start an upload (POST)
 *   /v2/<o>/<r>[/<img>]/blobs/uploads/<id> → chunk (PATCH) / finalize (PUT)
 *   /v2/<o>/<r>[/<img>]/tags/list          → list tags
 *
 * Pure parsing — no I/O — so it is unit-tested directly.
 */

export type OciName = { name: string; owner: string; repo: string; image: string };

export type OciTarget =
  | { kind: "version" }
  | { kind: "manifest"; name: OciName; reference: string }
  | { kind: "blob"; name: OciName; digest: string }
  | { kind: "upload-start"; name: OciName }
  | { kind: "upload-session"; name: OciName; uuid: string }
  | { kind: "tags"; name: OciName }
  | { kind: "unknown" };

const KEYWORDS = new Set(["manifests", "blobs", "tags"]);

export function parseOciRequest(path: string[] | undefined): OciTarget {
  if (!path || path.length === 0) return { kind: "version" };

  const idx = path.findIndex((p) => KEYWORDS.has(p));
  // Need at least owner+repo before the keyword.
  if (idx < 2) return { kind: "unknown" };

  const name = splitName(path.slice(0, idx));
  if (!name) return { kind: "unknown" };

  const keyword = path[idx];
  const rest = path.slice(idx + 1);

  if (keyword === "manifests") {
    if (rest.length === 0) return { kind: "unknown" };
    return { kind: "manifest", name, reference: rest.join("/") };
  }

  if (keyword === "tags") {
    return rest[0] === "list" ? { kind: "tags", name } : { kind: "unknown" };
  }

  // keyword === "blobs"
  if (rest[0] === "uploads") {
    if (rest.length === 1) return { kind: "upload-start", name };
    return { kind: "upload-session", name, uuid: rest[1] };
  }
  if (rest.length >= 1) return { kind: "blob", name, digest: rest[0] };
  return { kind: "unknown" };
}

/** Split the `<name>` path into owner / repo / image. */
export function splitName(segments: string[]): OciName | null {
  const segs = segments.filter(Boolean);
  if (segs.length < 2) return null;
  const [owner, repo, ...img] = segs;
  const image = img.length > 0 ? img.join("/") : repo;
  return { name: segs.join("/"), owner, repo, image };
}
