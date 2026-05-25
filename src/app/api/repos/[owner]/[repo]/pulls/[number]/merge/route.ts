import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import {
  getPullRequest,
  markPullRequestMerged,
} from "@/lib/registry/pulls";
import { mergeBranches } from "@/lib/git/merge";
import { repoPath } from "@/lib/git/backend";
import { displayNameForWebId } from "@/lib/solid/web-id";
import { getIssueById, updateIssue } from "@/lib/registry/issues";
import { writeIssueToPod } from "@/lib/solid/issues";
import { requireOwner } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export async function POST(_req: Request, { params }: Params) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ error: "invalid number" }, { status: 400 });
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  const pull = getPullRequest(repo.id, number);
  if (!pull) {
    return NextResponse.json({ error: "pull not found" }, { status: 404 });
  }
  if (pull.status !== "open") {
    return NextResponse.json(
      { error: `pull is ${pull.status}, cannot merge` },
      { status: 409 },
    );
  }

  // Attribute the merge to the repo owner (the human in the loop).
  // The WebID goes in the email slot so the commit carries a
  // verifiable identity link; the display name comes from the WebID
  // URL's first path segment (e.g. "alice").
  const bare = repoPath(repo.owner, repo.name);
  const result = await mergeBranches(
    bare,
    pull.sourceBranch,
    pull.targetBranch,
    `Merge pull request #${pull.number}: ${pull.title}`,
    {
      name: displayNameForWebId(repo.ownerWebId),
      email: repo.ownerWebId,
    },
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, conflict: result.conflict },
      { status: result.conflict ? 409 : 500 },
    );
  }

  const merged = markPullRequestMerged(pull.id, result.mergeSha);

  // Auto-close any linked issue. Best-effort: a pod-write failure should
  // not undo the merge, so the catch logs and moves on.
  let closedIssueNumber: number | null = null;
  if (merged.issueId !== null) {
    const issue = getIssueById(merged.issueId);
    if (issue && issue.status === "open") {
      const updated = updateIssue(issue.id, { status: "closed" });
      closedIssueNumber = updated.number;
      writeIssueToPod(repo, updated).catch((err) => {
        console.warn(
          `[pulls.merge] writeIssueToPod for ${owner}/${name}#${updated.number} failed:`,
          err,
        );
      });
    }
  }

  return NextResponse.json({ pull: merged, closedIssueNumber });
}
