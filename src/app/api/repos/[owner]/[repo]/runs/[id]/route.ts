import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { getRunById } from "@/lib/registry/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; id: string }>;
};

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name, id } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const numericId = Number.parseInt(id, 10);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }
  const run = getRunById(numericId);
  if (!run || run.repoId !== repo.id) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
