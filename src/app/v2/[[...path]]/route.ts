import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatePackagePush } from "@/lib/packages/auth";
import { type OciName, parseOciRequest } from "@/lib/packages/oci";
import { abortUpload, appendChunk, finishUpload, startUpload } from "@/lib/packages/oci-uploads";
import { getRepoContentStore } from "@/lib/packages/repo-store";
import {
  getPackageVersion,
  isDigestRef,
  listVersions,
  PackageError,
  upsertPackageVersion,
  validatePackageName,
  validateVersion,
} from "@/lib/packages/store";
import { assertCanStorePackage, QUOTAS, QuotaExceededError } from "@/lib/registry/quotas";
import { getRepo, type Repo, validateName } from "@/lib/registry/repos";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Params = { params: Promise<{ path?: string[] }> };

const API_VERSION = { "Docker-Distribution-Api-Version": "registry/2.0" };

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request, { params }: Params) {
  const target = parseOciRequest((await params).path);
  switch (target.kind) {
    case "version":
      return new NextResponse(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json", ...API_VERSION },
      });
    case "manifest":
      return getManifest(req, target.name, target.reference, false);
    case "blob":
      return getBlob(req, target.name, target.digest, false);
    case "tags":
      return listTags(req, target.name);
    default:
      return ociError(404, "UNSUPPORTED", "unsupported request");
  }
}

// ── HEAD ────────────────────────────────────────────────────────────────────

export async function HEAD(req: Request, { params }: Params) {
  const target = parseOciRequest((await params).path);
  switch (target.kind) {
    case "version":
      return new NextResponse(null, { status: 200, headers: { ...API_VERSION } });
    case "manifest":
      return getManifest(req, target.name, target.reference, true);
    case "blob":
      return getBlob(req, target.name, target.digest, true);
    default:
      return new NextResponse(null, { status: 404, headers: { ...API_VERSION } });
  }
}

// ── POST (start upload, or monolithic single-POST) ──────────────────────────

export async function POST(req: Request, { params }: Params) {
  const target = parseOciRequest((await params).path);
  if (target.kind !== "upload-start") {
    return ociError(404, "UNSUPPORTED", "unsupported request");
  }
  const repo = resolveRepo(target.name);
  if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
  if (!authenticatePackagePush(repo.id, req)) return unauthorized(target.name);

  const digest = new URL(req.url).searchParams.get("digest");
  if (digest) {
    // Monolithic single-POST upload: the whole blob is in this request.
    const tooBig = oversizeByContentLength(req);
    if (tooBig) return tooBig;
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > 0) return finalizeBlob(repo, target.name, bytes, digest);
  }

  const uuid = startUpload();
  return new NextResponse(null, {
    status: 202,
    headers: {
      Location: `/v2/${target.name.name}/blobs/uploads/${uuid}`,
      "Docker-Upload-UUID": uuid,
      Range: "0-0",
      ...API_VERSION,
    },
  });
}

// ── PATCH (append a chunk) ──────────────────────────────────────────────────

export async function PATCH(req: Request, { params }: Params) {
  const target = parseOciRequest((await params).path);
  if (target.kind !== "upload-session") {
    return ociError(404, "UNSUPPORTED", "unsupported request");
  }
  const repo = resolveRepo(target.name);
  if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
  if (!authenticatePackagePush(repo.id, req)) return unauthorized(target.name);

  const tooBig = oversizeByContentLength(req);
  if (tooBig) {
    abortUpload(target.uuid);
    return tooBig;
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  const size = appendChunk(target.uuid, bytes);
  if (size === null) {
    return ociError(404, "BLOB_UPLOAD_UNKNOWN", "unknown upload session");
  }
  if (size > QUOTAS.maxPackageBlobBytes) {
    abortUpload(target.uuid);
    return quota(new QuotaExceededError("maxPackageBlobBytes", QUOTAS.maxPackageBlobBytes, size));
  }
  return new NextResponse(null, {
    status: 202,
    headers: {
      Location: `/v2/${target.name.name}/blobs/uploads/${target.uuid}`,
      "Docker-Upload-UUID": target.uuid,
      Range: `0-${Math.max(size - 1, 0)}`,
      ...API_VERSION,
    },
  });
}

// ── PUT (finalize blob upload, or push manifest) ────────────────────────────

export async function PUT(req: Request, { params }: Params) {
  const target = parseOciRequest((await params).path);

  if (target.kind === "upload-session") {
    const repo = resolveRepo(target.name);
    if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
    if (!authenticatePackagePush(repo.id, req)) return unauthorized(target.name);

    const digest = new URL(req.url).searchParams.get("digest");
    if (!digest) return ociError(400, "DIGEST_INVALID", "missing digest on upload finalize");
    const tooBig = oversizeByContentLength(req);
    if (tooBig) {
      abortUpload(target.uuid);
      return tooBig;
    }
    const trailing = new Uint8Array(await req.arrayBuffer());
    const full = finishUpload(target.uuid, trailing);
    if (full === null) {
      return ociError(404, "BLOB_UPLOAD_UNKNOWN", "unknown upload session");
    }
    return finalizeBlob(repo, target.name, full, digest);
  }

  if (target.kind === "manifest") {
    const repo = resolveRepo(target.name);
    if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
    if (!authenticatePackagePush(repo.id, req)) return unauthorized(target.name);
    const bytes = new Uint8Array(await req.arrayBuffer());
    const contentType =
      req.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/vnd.oci.image.manifest.v1+json";
    return putManifest(repo, target.name, target.reference, bytes, contentType);
  }

  return ociError(404, "UNSUPPORTED", "unsupported request");
}

// ── handlers ────────────────────────────────────────────────────────────────

async function finalizeBlob(
  repo: Repo,
  name: OciName,
  bytes: Uint8Array,
  expectedDigest: string,
): Promise<NextResponse> {
  try {
    assertCanStorePackage(repo.id, bytes.byteLength);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quota(e);
    throw e;
  }

  const computed = `sha256:${sha256(bytes)}`;
  if (expectedDigest && expectedDigest !== computed) {
    return ociError(
      400,
      "DIGEST_INVALID",
      `digest mismatch: client ${expectedDigest} != computed ${computed}`,
    );
  }

  let handle;
  try {
    handle = await getRepoContentStore(repo, "write");
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return ociError(503, "UNAVAILABLE", e.message);
    }
    throw e;
  }
  try {
    await handle.store.save(bytes);
  } finally {
    await handle.cleanup().catch(() => {});
  }

  return new NextResponse(null, {
    status: 201,
    headers: {
      Location: `/v2/${name.name}/blobs/${computed}`,
      "Docker-Content-Digest": computed,
      ...API_VERSION,
    },
  });
}

async function putManifest(
  repo: Repo,
  name: OciName,
  reference: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<NextResponse> {
  try {
    validatePackageName(name.image, "oci");
    validateVersion(reference);
    assertCanStorePackage(repo.id, bytes.byteLength);
  } catch (e) {
    if (e instanceof PackageError) return ociError(400, "MANIFEST_INVALID", e.message);
    if (e instanceof QuotaExceededError) return quota(e);
    throw e;
  }

  let handle;
  try {
    handle = await getRepoContentStore(repo, "write");
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return ociError(503, "UNAVAILABLE", e.message);
    }
    throw e;
  }

  let manifestDigest: string;
  try {
    const blob = await handle.store.save(bytes);
    manifestDigest = blob.digest;
    const meta = { mediaType: contentType };
    // Index by the pushed reference (tag or digest)…
    upsertPackageVersion({
      repoId: repo.id,
      type: "oci",
      name: name.image,
      version: reference,
      digest: manifestDigest,
      sizeBytes: blob.size,
      contentType,
      metadata: meta,
    });
    // …and also by digest, so pull-by-digest resolves.
    if (reference !== manifestDigest) {
      upsertPackageVersion({
        repoId: repo.id,
        type: "oci",
        name: name.image,
        version: manifestDigest,
        digest: manifestDigest,
        sizeBytes: blob.size,
        contentType,
        metadata: meta,
      });
    }
  } finally {
    await handle.cleanup().catch(() => {});
  }

  return new NextResponse(null, {
    status: 201,
    headers: {
      Location: `/v2/${name.name}/manifests/${manifestDigest}`,
      "Docker-Content-Digest": manifestDigest,
      ...API_VERSION,
    },
  });
}

async function getManifest(
  req: Request,
  name: OciName,
  reference: string,
  headOnly: boolean,
): Promise<NextResponse> {
  const repo = resolveRepo(name);
  if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
  if (repo.visibility === "private" && !authenticatePackagePush(repo.id, req)) {
    return unauthorized(name);
  }

  const row = getPackageVersion(repo.id, "oci", name.image, reference);
  if (!row) return ociError(404, "MANIFEST_UNKNOWN", "manifest unknown");

  const headers: Record<string, string> = {
    "Content-Type": row.contentType ?? "application/vnd.oci.image.manifest.v1+json",
    "Docker-Content-Digest": row.digest,
    "Content-Length": String(row.sizeBytes),
    ...API_VERSION,
  };
  if (headOnly) return new NextResponse(null, { status: 200, headers });

  const { store } = await getRepoContentStore(repo, "read");
  const bytes = await store.open(row.digest);
  if (!bytes) return ociError(404, "MANIFEST_UNKNOWN", "manifest blob missing");
  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    status: 200,
    headers,
  });
}

async function getBlob(
  req: Request,
  name: OciName,
  digest: string,
  headOnly: boolean,
): Promise<NextResponse> {
  const repo = resolveRepo(name);
  if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
  if (repo.visibility === "private" && !authenticatePackagePush(repo.id, req)) {
    return unauthorized(name);
  }

  const { store } = await getRepoContentStore(repo, "read");

  if (headOnly) {
    const exists = await store.has(digest);
    if (!exists) return new NextResponse(null, { status: 404, headers: { ...API_VERSION } });
    return new NextResponse(null, {
      status: 200,
      headers: { "Docker-Content-Digest": digest, ...API_VERSION },
    });
  }

  const bytes = await store.open(digest);
  if (!bytes) return ociError(404, "BLOB_UNKNOWN", "blob unknown");
  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Docker-Content-Digest": digest,
      "Content-Length": String(bytes.byteLength),
      ...API_VERSION,
    },
  });
}

async function listTags(req: Request, name: OciName): Promise<NextResponse> {
  const repo = resolveRepo(name);
  if (!repo) return ociError(404, "NAME_UNKNOWN", "repository not found");
  if (repo.visibility === "private" && !authenticatePackagePush(repo.id, req)) {
    return unauthorized(name);
  }
  const tags = listVersions(repo.id, "oci", name.image)
    .map((r) => r.version)
    .filter((v) => !isDigestRef(v));
  return NextResponse.json({ name: name.name, tags }, { headers: { ...API_VERSION } });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function resolveRepo(name: OciName): Repo | null {
  try {
    validateName(name.owner, "owner");
    validateName(name.repo, "repo");
    validatePackageName(name.image, "oci");
  } catch {
    return null;
  }
  return getRepo(name.owner, name.repo);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ociError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { errors: [{ code, message }] },
    { status, headers: { ...API_VERSION } },
  );
}

function unauthorized(name: OciName): NextResponse {
  return new NextResponse(
    JSON.stringify({ errors: [{ code: "UNAUTHORIZED", message: "authentication required" }] }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Basic realm="${name.owner}/${name.repo}"`,
        ...API_VERSION,
      },
    },
  );
}

/**
 * Reject an oversize blob upload by its declared `Content-Length` *before* the
 * body is buffered into memory. OCI v0 buffers each blob in RAM (see
 * `oci-uploads.ts`), so a multi-GB layer would OOM the bridge during
 * `req.arrayBuffer()` — long before the post-buffer caps in `appendChunk`/
 * `finalizeBlob` ever run. A truthful `Content-Length` lets us 413 up front; a
 * lying or absent one still hits the cumulative cap downstream.
 */
function oversizeByContentLength(req: Request): NextResponse | null {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > QUOTAS.maxPackageBlobBytes) {
    return quota(
      new QuotaExceededError("maxPackageBlobBytes", QUOTAS.maxPackageBlobBytes, declared),
    );
  }
  return null;
}

function quota(e: QuotaExceededError): NextResponse {
  return NextResponse.json(
    {
      errors: [
        {
          code: "TOOMANYREQUESTS",
          message: e.message,
          detail: { quota: e.quota, limit: e.limit, observed: e.observed },
        },
      ],
    },
    { status: 413, headers: { ...API_VERSION } },
  );
}
