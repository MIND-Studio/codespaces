import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http/json";
import { getRepo } from "@/lib/registry/repos";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";
import { addMember, isMemberRole, readMembers } from "@/lib/solid/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * List the repo's members (WebID → role) from the pod-native `members.ttl`
 * roster. Any member (`reader`+) or the owner may read it; the owner is an
 * implicit admin (ADR-0002).
 */
export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireMember(repo, "reader");
  if (!auth.ok) return auth.response;

  try {
    const members = await readMembers(repo);
    return jsonResponse({ members });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[members] list failed", e);
    return NextResponse.json({ error: "failed to read members" }, { status: 500 });
  }
}

/**
 * Add (or change the role of) a member, granting the matching pod ACLs.
 * Admin-only — managing membership requires `admin` (the owner qualifies).
 * Body: `{ "webId": "...", "role": "reader" | "writer" | "admin" }`.
 */
export async function POST(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireMember(repo, "admin");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { webId, role } = (body ?? {}) as Record<string, unknown>;
  if (typeof webId !== "string" || !webId.startsWith("http")) {
    return NextResponse.json({ error: "webId must be an http(s) WebID" }, { status: 400 });
  }
  if (typeof role !== "string" || !isMemberRole(role)) {
    return NextResponse.json({ error: "role must be reader|writer|admin" }, { status: 400 });
  }
  if (webId === repo.ownerWebId) {
    return NextResponse.json(
      { error: "owner is an implicit admin; cannot be added as a member" },
      { status: 400 },
    );
  }

  try {
    const members = await addMember(repo, webId, role);
    return jsonResponse({ members }, { status: 201 });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      return NextResponse.json(
        { error: "reauthorize this pod via /connect", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[members] add failed", e);
    return NextResponse.json({ error: "failed to add member" }, { status: 500 });
  }
}
