import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import {
  upsertPackageVersion,
  getPackageVersion,
  validatePackageName,
  validateVersion,
  PackageError,
} from "@/lib/packages/store";
import { authenticatePackagePush } from "@/lib/packages/auth";
import { getRepoContentStore } from "@/lib/packages/repo-store";
import { assertCanStorePackage, QuotaExceededError } from "@/lib/registry/quotas";
import { requireOwner } from "@/lib/auth/session";
import { mimeForPath } from "@/lib/pages/mime";
import {
  OwnerFetchUnavailableError,
} from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
};

/**
 * Generic file/zip artifacts (docs/PACKAGES-PLAN.md → "generic files").
 *
 *   PUT /api/repos/{o}/{r}/files/{version}/{filename}   — upload (push token)
 *   GET /api/repos/{o}/{r}/files/{version}/{filename}   — download
 *
 * The bytes go into the pod CAS; the index row (type='file') maps
 * (filename, version) → blob digest. Downloads are served back through the
 * bridge with the stored content type.
 */
export async function PUT(req: Request, { params }: Params) {
  const { owner, repo: name, path } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  if (!authenticatePackagePush(repo.id, req)) {
    return unauthorized(owner, name);
  }

  if (!Array.isArray(path) || path.length !== 2) {
    return NextResponse.json(
      { error: "expected path /files/{version}/{filename}" },
      { status: 400 },
    );
  }
  const [version, filename] = path;
  try {
    validateVersion(version);
    validatePackageName(filename, "file");
  } catch (e) {
    if (e instanceof PackageError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  try {
    assertCanStorePackage(repo.id, bytes.byteLength);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quota(e);
    throw e;
  }

  let storeHandle;
  try {
    storeHandle = await getRepoContentStore(repo, "write");
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: e.message, code: "OWNER_UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw e;
  }
  const { store, cleanup } = storeHandle;
  try {
    const blob = await store.save(bytes);
    const contentType =
      req.headers.get("content-type")?.split(";")[0]?.trim() ||
      mimeForPath(filename);
    upsertPackageVersion({
      repoId: repo.id,
      type: "file",
      name: filename,
      version,
      digest: blob.digest,
      sizeBytes: blob.size,
      contentType,
    });
    const downloadUrl = `${req.url}`;
    return NextResponse.json(
      { ok: true, name: filename, version, digest: blob.digest, size: blob.size, url: downloadUrl },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: e.message, code: "OWNER_UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw e;
  } finally {
    await cleanup().catch(() => {});
  }
}

export async function GET(req: Request, { params }: Params) {
  const { owner, repo: name, path } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  if (repo.visibility === "private") {
    if (!authenticatePackagePush(repo.id, req)) {
      // For private repos, downloading also needs a valid token. Owner
      // sessions count too (browser dashboard download).
      const auth = await requireOwner(repo.ownerWebId);
      if (!auth.ok) return unauthorized(owner, name);
    }
  }

  if (!Array.isArray(path) || path.length !== 2) {
    return NextResponse.json(
      { error: "expected path /files/{version}/{filename}" },
      { status: 400 },
    );
  }
  const [version, filename] = path;
  const record = getPackageVersion(repo.id, "file", filename, version);
  if (!record) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const { store } = await getRepoContentStore(repo, "read");
  const bytes = await store.open(record.digest);
  if (!bytes) {
    return NextResponse.json({ error: "blob missing from pod" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": record.contentType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function unauthorized(owner: string, name: string): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: "missing or invalid push token" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Basic realm="${owner}/${name}"`,
      },
    },
  );
}

function quota(e: QuotaExceededError): NextResponse {
  return NextResponse.json(
    {
      error: e.message,
      code: "QUOTA_EXCEEDED",
      quota: e.quota,
      limit: e.limit,
      observed: e.observed,
    },
    { status: 413 },
  );
}
