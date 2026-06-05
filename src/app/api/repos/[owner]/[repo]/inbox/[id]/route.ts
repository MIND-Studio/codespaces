import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { requireOwner } from "@/lib/auth/session";
import { deleteProposal } from "@/lib/solid/inbox";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string; id: string }> };

/**
 * Dismiss a proposal — delete the notification from the owner's pod inbox
 * without minting an issue. Owner-only.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { owner, repo: name, id } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  try {
    const ok = await deleteProposal(repo, id);
    if (!ok) {
      return NextResponse.json({ error: "invalid proposal id" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[inbox] dismiss failed", e);
    return NextResponse.json({ error: "failed to dismiss proposal" }, { status: 500 });
  }
}
