import { NextResponse } from "next/server";
import { getRepo, RegistryError } from "@/lib/registry/repos";
import {
  createIssue,
  listIssues,
  setIssuePodUrl,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/registry/issues";
import { issueUrl, writeIssueToPod } from "@/lib/solid/issues";
import { ensureAgentsBootstrap } from "@/lib/agents/bootstrap";
import { dispatch } from "@/lib/agents/dispatch";
import { requireOwner } from "@/lib/auth/session";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { jsonResponse } from "@/lib/http/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "open";
  if (!["open", "closed", "all"].includes(statusParam)) {
    return NextResponse.json(
      { error: "status must be open|closed|all" },
      { status: 400 },
    );
  }
  const issues = listIssues(repo.id, {
    status: statusParam as IssueStatus | "all",
  });
  return jsonResponse({ issues });
}

export async function POST(req: Request, { params }: Params) {
  const limited = await rateLimit("issueCreate", RATE_LIMITS.issueCreate);
  if (limited) return limited;
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    title,
    body: issueBody,
    priority,
    labels,
    authorWebId,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string") {
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 },
    );
  }
  // The session establishes who is authoring this issue. Any
  // bodysupplied authorWebId that disagrees with the session is rejected
  // to prevent identity spoofing on the issue thread.
  if (typeof authorWebId === "string" && authorWebId !== auth.webId) {
    return NextResponse.json(
      { error: "authorWebId must match the authenticated session", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  const author = auth.webId;

  let issue;
  try {
    // We need the issue number to compute the canonical pod URL, but we
    // need to insert to allocate the number. Two-step: insert with a
    // placeholder pod_url, then UPDATE once we know the number. Cheaper
    // than precomputing the next number outside a transaction (race).
    issue = createIssue({
      repoId: repo.id,
      title,
      body: typeof issueBody === "string" ? issueBody : "",
      priority:
        priority === "low" || priority === "normal" || priority === "high"
          ? (priority as IssuePriority)
          : undefined,
      labels: Array.isArray(labels) ? labels : undefined,
      authorWebId: author,
      podUrl: "pending",
    });
  } catch (e) {
    if (e instanceof RegistryError) {
      const status = e.code === "ALREADY_EXISTS" ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }

  // Patch in the canonical URL now that we know the number, then mirror
  // to the pod best-effort.
  const canonical = issueUrl(repo, issue.number);
  setIssuePodUrl(issue.id, canonical);
  issue.podUrl = canonical;

  writeIssueToPod(repo, issue).catch((err) => {
    console.warn(
      `[issues.POST] writeIssueToPod for ${owner}/${name}#${issue!.number} failed:`,
      err,
    );
  });

  // Fire the agent event. Best-effort: the dispatch is async and any
  // driver error is captured in the per-role outcome, not thrown.
  ensureAgentsBootstrap();
  const issueRef = issue;
  // MIND_ISSUE_DRIVER (e.g. "codex") overrides the backend for auto-fired
  // issue agents so a single driver runs. Without it the default `coder`
  // role fires its own driver and would race a separately-dispatched
  // backend on the same agent/issue-{n} branch (non-fast-forward push).
  const issueDriver = process.env.MIND_ISSUE_DRIVER?.trim() || undefined;
  dispatch(
    {
      type: "issue.created",
      repoOwner: owner,
      repoName: name,
      issueNumber: issueRef.number,
    },
    { driver: issueDriver },
  )
    .then((outcomes) => {
      if (outcomes.length > 0) {
        console.log(
          `[agents] issue.created ${owner}/${name}#${issueRef.number} → ${outcomes
            .map((o) => `${o.role}/${o.driver}=${o.result.status}`)
            .join(" ")}`,
        );
      }
    })
    .catch((err) => {
      console.warn(`[agents] dispatch failed for issue.created:`, err);
    });

  return NextResponse.json({ issue: issueRef }, { status: 201 });
}
