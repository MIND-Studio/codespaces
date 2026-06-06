import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { requireMember } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http/json";
import { removeMember } from "@/lib/solid/members";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; webid: string }>;
};

/**
 * Remove a member from the roster and re-apply the pod ACLs without them
 * (revocation is a single roster write + ACL rewrite — atomic). Admin-only.
 * The `[webid]` segment is the `encodeURIComponent`-encoded member WebID.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { owner, repo: name, webid } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireMember(repo, "admin");
  if (!auth.ok) return auth.response;

  const webId = decodeURIComponent(webid);
  try {
    const members = await removeMember(repo, webId);
    return jsonResponse({ members });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[members] remove failed", e);
    return NextResponse.json({ error: "failed to remove member" }, { status: 500 });
  }
}
