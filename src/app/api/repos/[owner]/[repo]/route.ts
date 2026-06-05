import { NextResponse } from "next/server";
import {
  getRepo,
  getPagesConfig,
  RegistryError,
  updateRepo,
  deleteRepoById,
} from "@/lib/registry/repos";
import { writeRepoMetadata } from "@/lib/solid/repo-metadata";
import { requireOwner } from "@/lib/auth/session";
import { deleteBareRepo } from "@/lib/git/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  let repo;
  try {
    repo = getRepo(owner, name);
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const pages = getPagesConfig(repo.id);
  return NextResponse.json({ repo, pages });
}

export async function PATCH(req: Request, { params }: Params) {
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
  const { visibility, defaultBranch, proposalsEnabled, collabEnabled } =
    (body ?? {}) as Record<string, unknown>;

  try {
    const updated = updateRepo(owner, name, {
      visibility:
        visibility === "public" || visibility === "private"
          ? visibility
          : undefined,
      defaultBranch:
        typeof defaultBranch === "string" ? defaultBranch : undefined,
      proposalsEnabled:
        typeof proposalsEnabled === "boolean" ? proposalsEnabled : undefined,
      collabEnabled:
        typeof collabEnabled === "boolean" ? collabEnabled : undefined,
    });
    writeRepoMetadata(updated, getPagesConfig(updated.id)).catch((err) => {
      console.warn(
        `[repos.PATCH] writeRepoMetadata for ${owner}/${name} failed:`,
        err,
      );
    });
    return NextResponse.json({ repo: updated });
  } catch (e) {
    if (e instanceof RegistryError) {
      const status =
        e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_NAME" ? 400 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    throw e;
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  // The DELETE body is optional. When sent, it carries a confirm string
  // the client must echo back to prevent accidental fetches from deleting
  // a repo just because the URL was hit. The expected value is the repo's
  // own "owner/name" — easy for the UI to assemble, near-impossible to
  // collide on by accident.
  let confirm: string | undefined;
  try {
    if (req.body) {
      const body = (await req.json()) as Record<string, unknown> | null;
      if (body && typeof body.confirm === "string") confirm = body.confirm;
    }
  } catch {
    // Body parsing is best-effort; missing/invalid → fall through to the
    // confirm check below which will reject.
  }

  const expected = `${owner}/${name}`;
  if (confirm !== expected) {
    return NextResponse.json(
      {
        error: `confirm must equal "${expected}"`,
        code: "CONFIRM_MISMATCH",
      },
      { status: 400 },
    );
  }

  // Drop registry row first. ON DELETE CASCADE on pages_configs,
  // push_tokens, workflow_runs, issues, pull_requests, agent_runs cleans
  // their rows up automatically.
  deleteRepoById(repo.id);

  // Then remove the bare repo on disk. Best-effort: if it fails (e.g. an
  // FS permission error) the registry is already gone, so the URL 404s
  // and the operator can rm the stragglers manually.
  try {
    await deleteBareRepo(owner, name);
  } catch (err) {
    console.warn(
      `[repos.DELETE] failed to remove bare repo for ${owner}/${name}:`,
      err,
    );
  }

  return NextResponse.json({ ok: true });
}
