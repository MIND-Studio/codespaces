import { NextResponse } from "next/server";
import { getRepo, RegistryError } from "@/lib/registry/repos";
import {
  getIssueByNumber,
  listComments,
  updateIssue,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/registry/issues";
import { writeIssueToPod } from "@/lib/solid/issues";
import { requireOwner } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

function parseNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = parseNumber(rawNumber);
  if (number === null) {
    return NextResponse.json({ error: "invalid issue number" }, { status: 400 });
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const issue = getIssueByNumber(repo.id, number);
  if (!issue) {
    return NextResponse.json({ error: "issue not found" }, { status: 404 });
  }
  return NextResponse.json({ issue, comments: listComments(issue.id) });
}

export async function PATCH(req: Request, { params }: Params) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = parseNumber(rawNumber);
  if (number === null) {
    return NextResponse.json({ error: "invalid issue number" }, { status: 400 });
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  const issue = getIssueByNumber(repo.id, number);
  if (!issue) {
    return NextResponse.json({ error: "issue not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, priority, labels, title, body: issueBody } =
    (body ?? {}) as Record<string, unknown>;

  try {
    const updated = updateIssue(issue.id, {
      status:
        status === "open" || status === "closed"
          ? (status as IssueStatus)
          : undefined,
      priority:
        priority === "low" || priority === "normal" || priority === "high"
          ? (priority as IssuePriority)
          : undefined,
      labels: Array.isArray(labels) ? labels : undefined,
      title: typeof title === "string" ? title : undefined,
      body: typeof issueBody === "string" ? issueBody : undefined,
    });

    writeIssueToPod(repo, updated).catch((err) => {
      console.warn(
        `[issues.PATCH] writeIssueToPod for ${owner}/${name}#${number} failed:`,
        err,
      );
    });

    return NextResponse.json({ issue: updated });
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
