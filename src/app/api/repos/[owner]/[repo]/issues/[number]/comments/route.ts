import { NextResponse } from "next/server";
import { ensureAgentsBootstrap } from "@/lib/agents/bootstrap";
import { dispatch } from "@/lib/agents/dispatch";
import { requireOwner } from "@/lib/auth/session";
import {
  addComment,
  getIssueByNumber,
  listComments,
  setCommentPodUrl,
} from "@/lib/registry/issues";
import { getRepo, RegistryError } from "@/lib/registry/repos";
import { commentUrl, writeCommentToPod } from "@/lib/solid/issues";

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
  return NextResponse.json({ comments: listComments(issue.id) });
}

export async function POST(req: Request, { params }: Params) {
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
  const { body: commentBody, authorWebId } = (body ?? {}) as Record<string, unknown>;
  if (typeof commentBody !== "string" || commentBody.trim().length === 0) {
    return NextResponse.json({ error: "body is required and must be non-empty" }, { status: 400 });
  }
  // The session establishes who is authoring this comment. A bodysupplied
  // authorWebId that disagrees with the session would let any
  // authenticated user impersonate someone else on the issue thread.
  if (typeof authorWebId === "string" && authorWebId !== auth.webId) {
    return NextResponse.json(
      { error: "authorWebId must match the authenticated session", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  const author = auth.webId;

  let comment;
  try {
    comment = addComment({
      issueId: issue.id,
      authorWebId: author,
      body: commentBody,
      podUrl: "pending",
    });
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const canonical = commentUrl(repo, issue.number, comment.id);
  setCommentPodUrl(comment.id, canonical);
  comment.podUrl = canonical;

  writeCommentToPod(repo, issue.number, comment).catch((err) => {
    console.warn(`[comments.POST] writeCommentToPod for ${owner}/${name}#${number} failed:`, err);
  });

  // Re-fire the coder on the new comment so the conversation keeps
  // moving. Agent-authored comments (those that already carry an
  // agent_run_id) skip this to avoid an infinite loop where the coder
  // re-triggers on its own clarifying question.
  if (comment.agentRunId === null) {
    ensureAgentsBootstrap();
    // See MIND_ISSUE_DRIVER note in the issues route: pick a single backend
    // for auto-fired issue agents so coder + an override don't race.
    const issueDriver = process.env.MIND_ISSUE_DRIVER?.trim() || undefined;
    dispatch(
      {
        type: "issue.commented",
        repoOwner: owner,
        repoName: name,
        issueNumber: issue.number,
        commentId: comment.id,
      },
      { driver: issueDriver },
    )
      .then((outcomes) => {
        if (outcomes.length > 0) {
          console.log(
            `[agents] issue.commented ${owner}/${name}#${issue.number} → ${outcomes
              .map((o) => `${o.role}/${o.driver}=${o.result.status}`)
              .join(" ")}`,
          );
        }
      })
      .catch((err) => {
        console.warn(`[agents] dispatch failed for issue.commented:`, err);
      });
  }

  return NextResponse.json({ comment }, { status: 201 });
}
