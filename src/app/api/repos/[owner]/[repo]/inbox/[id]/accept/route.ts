import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { repoPath } from "@/lib/git/backend";
import { getRepo } from "@/lib/registry/repos";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";
import { deleteProposal, getProposal, type Proposal } from "@/lib/solid/inbox";
import { createMindIssue, IssueAuthorError } from "@/lib/tracker/author";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string; id: string }> };

/**
 * Append a provenance footer recording where the proposal came from. The
 * created `.mind` issue's `author` is the owner (who is committing it), so
 * the proposer's identity lives here in the body instead.
 */
function provenanceFooter(p: Proposal): string {
  const who = p.proposerWebId
    ? `[${p.proposerWebId}](${p.proposerWebId})`
    : p.contact
      ? `${p.contact} (unverified)`
      : "an anonymous visitor";
  const when = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "an unknown date";
  return `\n\n---\n_Proposed via the pod inbox by ${who} on ${when}; accepted by the repo owner._`;
}

/**
 * Accept a proposal: mint a `.mind` issue at todo from it, then
 * consume (delete) the inbox notification. Owner-only. The owner chooses
 * the issue `type` (default `feature`) and `priority` (default `normal`);
 * the normal todo → doing → review flow takes over from there.
 */
export async function POST(req: Request, { params }: Params) {
  const { owner, repo: name, id } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  let reqBody: unknown = {};
  try {
    reqBody = (await req.json()) ?? {};
  } catch {
    // An empty/absent body is fine — accept with defaults.
  }
  const { type, priority } = reqBody as Record<string, unknown>;

  let proposal: Proposal | null;
  try {
    proposal = await getProposal(repo, id);
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw e;
  }
  if (!proposal) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }

  try {
    const issue = await createMindIssue(repoPath(repo.owner, repo.name), owner, name, {
      title: proposal.title,
      type: typeof type === "string" && type ? type : "feature",
      epicSlug: null,
      priority: typeof priority === "string" ? priority : undefined,
      body: proposal.body + provenanceFooter(proposal),
      authorWebId: repo.ownerWebId,
    });

    // Consume the notification. If the delete fails the issue still exists;
    // the owner can dismiss the stray inbox entry manually.
    try {
      await deleteProposal(repo, id);
    } catch (e) {
      console.warn("[inbox] accept: issue created but inbox cleanup failed", e);
    }

    return NextResponse.json({ issue }, { status: 201 });
  } catch (e) {
    if (e instanceof IssueAuthorError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[inbox] accept failed", e);
    return NextResponse.json({ error: "failed to accept proposal" }, { status: 500 });
  }
}
