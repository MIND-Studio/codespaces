import { NextResponse } from "next/server";
import { getRepo, RegistryError } from "@/lib/registry/repos";
import { listPullRequests, upsertPullRequest } from "@/lib/registry/pulls";
import { listBranches } from "@/lib/git/objects";
import { repoPath } from "@/lib/git/backend";
import { requireOwner } from "@/lib/auth/session";
import { writePullToPod } from "@/lib/solid/pulls";

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
  if (!["open", "merged", "closed", "all"].includes(statusParam)) {
    return NextResponse.json(
      { error: "status must be open|merged|closed|all" },
      { status: 400 },
    );
  }
  const pulls = listPullRequests(
    repo.id,
    statusParam as "open" | "merged" | "closed" | "all",
  );
  return NextResponse.json({ pulls });
}

export async function POST(req: Request, { params }: Params) {
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
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const {
    title,
    body: prBody,
    sourceBranch,
    targetBranch,
    authorWebId,
    issueId,
  } = (body ?? {}) as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (typeof sourceBranch !== "string" || !sourceBranch.trim()) {
    return NextResponse.json(
      { error: "sourceBranch required" },
      { status: 400 },
    );
  }
  const target =
    typeof targetBranch === "string" && targetBranch.trim()
      ? targetBranch
      : repo.defaultBranch;
  if (sourceBranch === target) {
    return NextResponse.json(
      { error: "sourceBranch and targetBranch must differ" },
      { status: 400 },
    );
  }

  // Resolve both refs against the bare repo so we can record the source
  // tip and refuse PRs against branches that don't exist.
  const bare = repoPath(repo.owner, repo.name);
  const branches = await listBranches(bare);
  const byName = new Map(branches.map((b) => [b.name, b.sha]));
  const sourceSha = byName.get(sourceBranch);
  const targetSha = byName.get(target);
  if (!sourceSha) {
    return NextResponse.json(
      { error: `source branch '${sourceBranch}' not found` },
      { status: 400 },
    );
  }
  if (!targetSha) {
    return NextResponse.json(
      { error: `target branch '${target}' not found` },
      { status: 400 },
    );
  }

  try {
    const pull = upsertPullRequest({
      repoId: repo.id,
      title: title.trim(),
      body: typeof prBody === "string" ? prBody : "",
      sourceBranch,
      targetBranch: target,
      sourceSha,
      authorWebId:
        typeof authorWebId === "string" && authorWebId === auth.webId
          ? authorWebId
          : auth.webId,
      issueId: typeof issueId === "number" ? issueId : null,
    });

    // Mirror the PR to the owner's pod as canonical Turtle, best-effort
    // (mirrors how issues are written). A pod hiccup must never block the
    // PR open, so we fire-and-forget and only log on failure (#142).
    writePullToPod(repo, pull).catch((err) => {
      console.warn(
        `[pulls.POST] writePullToPod for ${owner}/${name}#${pull.number} failed:`,
        err,
      );
    });

    return NextResponse.json({ pull }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
