import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { repoPath } from "@/lib/git/backend";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRepo } from "@/lib/registry/repos";
import { createMindEpic, IssueAuthorError } from "@/lib/tracker/author";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * Create a new `.mind` epic in the repo and push it (git, event-sourced) — the
 * epic sibling of `POST .../mind-issues`. The git-sourced Issues board reads the
 * rebuilt `.mind/build/epics.ttl` from HEAD, so the (initially empty) epic group
 * appears after this returns.
 */
export async function POST(req: Request, { params }: Params) {
  const limited = await rateLimit("issueCreate", RATE_LIMITS.issueCreate);
  if (limited) return limited;

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
  const { title, body: epicBody, status } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const result = await createMindEpic(repoPath(repo.owner, repo.name), owner, name, {
      title,
      body: typeof epicBody === "string" ? epicBody : undefined,
      status: typeof status === "string" ? status : undefined,
      authorWebId: auth.webId,
    });
    return NextResponse.json({ epic: result }, { status: 201 });
  } catch (e) {
    if (e instanceof IssueAuthorError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[mind-epics] create failed", e);
    return NextResponse.json({ error: "epic creation failed" }, { status: 500 });
  }
}
