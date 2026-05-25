import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { getPullRequest } from "@/lib/registry/pulls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ error: "invalid number" }, { status: 400 });
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const pull = getPullRequest(repo.id, number);
  if (!pull) {
    return NextResponse.json({ error: "pull not found" }, { status: 404 });
  }
  return NextResponse.json({ pull });
}
