import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { listPackages, type PackageType } from "@/lib/packages/store";
import { requireOwner } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * GET /api/repos/{owner}/{repo}/packages — list published package versions.
 * Public repos are world-readable; private repos require the owner session.
 * Optional `?type=npm|oci|file` filter.
 */
export async function GET(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  if (repo.visibility === "private") {
    const auth = await requireOwner(repo.ownerWebId);
    if (!auth.ok) return auth.response;
  }

  const typeParam = new URL(req.url).searchParams.get("type");
  const type =
    typeParam === "npm" || typeParam === "oci" || typeParam === "file"
      ? (typeParam as PackageType)
      : undefined;

  const packages = listPackages(repo.id, type).map((p) => ({
    type: p.type,
    name: p.name,
    version: p.version,
    digest: p.digest,
    sizeBytes: p.sizeBytes,
    contentType: p.contentType,
    createdAt: p.createdAt,
  }));

  return jsonResponse({ packages });
}
