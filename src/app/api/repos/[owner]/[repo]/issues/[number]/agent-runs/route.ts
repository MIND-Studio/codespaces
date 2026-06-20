import { NextResponse } from "next/server";
import { listAgentRunsForIssue } from "@/lib/registry/agent-runs";
import { getIssueByNumber } from "@/lib/registry/issues";
import { getRepo } from "@/lib/registry/repos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string; number: string }> };

/**
 * Recent agent (coder) runs for an issue. Read-only, public — lets a client
 * (e.g. mind-builder) tell when the coder finished, is still running, or
 * errored/timed out WITHOUT opening a PR or comment, so it can surface that
 * instead of hanging on "working…".
 */
export async function GET(_req: Request, { params }: Params) {
  const { owner, repo, number: rawNumber } = await params;
  const n = Number(rawNumber);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "invalid issue number" }, { status: 400 });
  }
  const r = getRepo(owner, repo);
  if (!r) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  const issue = getIssueByNumber(r.id, n);
  if (!issue) return NextResponse.json({ error: "issue not found" }, { status: 404 });
  return NextResponse.json({ runs: listAgentRunsForIssue(issue.id) });
}
