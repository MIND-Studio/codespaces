import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { getRepo } from "@/lib/registry/repos";
import { revokePushToken } from "@/lib/registry/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; id: string }>;
};

export async function DELETE(_req: Request, { params }: Params) {
  const { owner, repo: name, id } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  const numericId = Number.parseInt(id, 10);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "invalid token id" }, { status: 400 });
  }
  const removed = revokePushToken(repo.id, numericId);
  if (!removed) {
    return NextResponse.json({ error: "token not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, revoked: numericId });
}
