import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { jsonResponse } from "@/lib/http/json";
import { authenticatePackagePush } from "@/lib/packages/auth";
import {
  buildPackument,
  findVersionByFilename,
  type NpmPublishBody,
  NpmPublishError,
  type NpmVersionMeta,
  parseNpmPublish,
} from "@/lib/packages/npm";
import { getRepoContentStore } from "@/lib/packages/repo-store";
import {
  listVersions,
  PackageError,
  upsertPackageVersion,
  validatePackageName,
  validateVersion,
} from "@/lib/packages/store";
import { assertCanStorePackage, QuotaExceededError } from "@/lib/registry/quotas";
import type { Repo } from "@/lib/registry/repos";
import { getRepo, RegistryError, validateName } from "@/lib/registry/repos";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; path?: string[] }>;
};

/**
 * npm registry protocol, repo-scoped (docs/PACKAGES-PLAN.md → npm phase).
 *
 * Point `.npmrc` at this repo's base URL:
 *   @alice:registry=https://bridge/api/packages/npm/alice/mylib/
 *   //bridge/api/packages/npm/alice/mylib/:_authToken=scp_…
 *
 *   PUT  …/{pkg}                  publish (token)
 *   GET  …/{pkg}                  packument (metadata)
 *   GET  …/{pkg}/-/{filename}     tarball
 */
export async function PUT(req: Request, { params }: Params) {
  const { owner, repo: repoName } = await params;
  const repo = lookupRepo(owner, repoName);
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });

  if (!authenticatePackagePush(repo.id, req)) return unauthorized(owner, repoName);

  let body: NpmPublishBody;
  try {
    body = (await req.json()) as NpmPublishBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseNpmPublish(body);
    validatePackageName(parsed.name, "npm");
    validateVersion(parsed.version);
  } catch (e) {
    if (e instanceof NpmPublishError || e instanceof PackageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  try {
    assertCanStorePackage(repo.id, parsed.tarballBytes.byteLength);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quota(e);
    throw e;
  }

  let handle;
  try {
    handle = await getRepoContentStore(repo, "write");
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json({ error: e.message, code: "OWNER_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }

  try {
    const blob = await handle.store.save(parsed.tarballBytes);
    const meta: NpmVersionMeta = {
      manifest: parsed.manifest,
      filename: parsed.tarballFilename,
      distTags: parsed.distTags,
    };
    upsertPackageVersion({
      repoId: repo.id,
      type: "npm",
      name: parsed.name,
      version: parsed.version,
      digest: blob.digest,
      sizeBytes: blob.size,
      contentType: "application/octet-stream",
      metadata: meta as unknown as Record<string, unknown>,
    });
    return NextResponse.json(
      { success: true, name: parsed.name, version: parsed.version },
      { status: 201 },
    );
  } finally {
    await handle.cleanup().catch(() => {});
  }
}

export async function GET(req: Request, { params }: Params) {
  const { owner, repo: repoName, path } = await params;
  const repo = lookupRepo(owner, repoName);
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });

  const segs = (path ?? []).map(decodeSegment);
  if (segs.length === 0) {
    return NextResponse.json({ error: "package name required" }, { status: 404 });
  }

  // Private repos require a token (or owner session) to read metadata/bytes.
  if (repo.visibility === "private" && !authenticatePackagePush(repo.id, req)) {
    return unauthorized(owner, repoName);
  }

  // Tarball: …/{pkg}/-/{filename}
  const dashIdx = segs.indexOf("-");
  if (dashIdx >= 0 && dashIdx < segs.length - 1) {
    const pkg = segs.slice(0, dashIdx).join("/");
    const filename = segs.slice(dashIdx + 1).join("/");
    return serveTarball(repo, pkg, filename);
  }

  // Packument: …/{pkg}
  const pkg = segs.join("/");
  const rows = listVersions(repo.id, "npm", pkg);
  if (rows.length === 0) {
    return NextResponse.json({ error: `package ${pkg} not found` }, { status: 404 });
  }
  const base = `${trimSlash(getEnv().bridgePublicUrl)}/api/packages/npm/${owner}/${repoName}`;
  return jsonResponse(buildPackument(pkg, rows, base));
}

async function serveTarball(repo: Repo, pkg: string, filename: string): Promise<NextResponse> {
  const rows = listVersions(repo.id, "npm", pkg);
  const record = findVersionByFilename(rows, filename);
  if (!record) {
    return NextResponse.json({ error: "tarball not found" }, { status: 404 });
  }
  const { store } = await getRepoContentStore(repo, "read");
  const bytes = await store.open(record.digest);
  if (!bytes) {
    return NextResponse.json({ error: "blob missing from pod" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

function lookupRepo(owner: string, repoName: string): Repo | null {
  try {
    validateName(owner, "owner");
    validateName(repoName, "repo");
  } catch (e) {
    if (e instanceof RegistryError) return null;
    throw e;
  }
  return getRepo(owner, repoName);
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function unauthorized(owner: string, name: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "missing or invalid push token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Basic realm="${owner}/${name}"`,
    },
  });
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

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
