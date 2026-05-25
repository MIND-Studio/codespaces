import { NextResponse } from "next/server";
import {
  getRepo,
  getPagesConfig,
  RegistryError,
  updatePagesConfig,
} from "@/lib/registry/repos";
import { writeRepoMetadata } from "@/lib/solid/repo-metadata";
import { requireOwner } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  return NextResponse.json({ pages: getPagesConfig(repo.id) });
}

export async function PUT(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { enabled, sourceBranch, sourcePath, targetContainer } =
    (body ?? {}) as Record<string, unknown>;

  try {
    const updated = updatePagesConfig(repo.id, {
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      sourceBranch:
        typeof sourceBranch === "string" ? sourceBranch : undefined,
      sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
      targetContainer:
        typeof targetContainer === "string" ? targetContainer : undefined,
    });
    writeRepoMetadata(repo, updated).catch((err) => {
      console.warn(
        `[pages.PUT] writeRepoMetadata for ${owner}/${name} failed:`,
        err,
      );
    });
    return NextResponse.json({ pages: updated });
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
