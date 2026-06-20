import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http/json";
import { getRepo } from "@/lib/registry/repos";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";
import { listProposals } from "@/lib/solid/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * List the pending issue proposals sitting in the owner's pod inbox.
 * Owner-only — the inbox is write-only for the public, read for the owner.
 */
export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  try {
    const proposals = await listProposals(repo);
    return jsonResponse({ proposals });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[inbox] list failed", e);
    return NextResponse.json({ error: "failed to read inbox" }, { status: 500 });
  }
}
