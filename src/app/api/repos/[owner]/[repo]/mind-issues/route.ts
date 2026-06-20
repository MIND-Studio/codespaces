import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { repoPath } from "@/lib/git/backend";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRepo } from "@/lib/registry/repos";
import { createMindIssue, IssueAuthorError } from "@/lib/tracker/author";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * Create a new `.mind` issue in the repo and push it (git, event-sourced). The
 * git-sourced Issues board reads the rebuilt `.mind/build/state.ttl` from HEAD,
 * so the issue appears on the board after this returns. Distinct from the legacy
 * flat-store `POST .../issues` route (SQLite + agent dispatch), which stays for
 * the coder loop.
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
  const { title, type, epic, priority, body: issueBody } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (typeof type !== "string" || !type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  try {
    const result = await createMindIssue(repoPath(repo.owner, repo.name), owner, name, {
      title,
      type,
      epicSlug: typeof epic === "string" ? epic : null,
      priority: typeof priority === "string" ? priority : undefined,
      body: typeof issueBody === "string" ? issueBody : undefined,
      authorWebId: auth.webId,
    });
    return NextResponse.json({ issue: result }, { status: 201 });
  } catch (e) {
    if (e instanceof IssueAuthorError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[mind-issues] create failed", e);
    return NextResponse.json({ error: "issue creation failed" }, { status: 500 });
  }
}
