import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { repoPath } from "@/lib/git/backend";
import { jsonResponse } from "@/lib/http/json";
import { assertCanDispatchRun, QuotaExceededError } from "@/lib/registry/quotas";
import { getRepo } from "@/lib/registry/repos";
import { listRunsForRepo } from "@/lib/registry/runs";
import { runWorkflow } from "@/lib/workflows/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  return jsonResponse({ runs: listRunsForRepo(repo.id, 50) });
}

/**
 * Manually trigger a workflow run for the repo. Useful when a previous
 * run failed for a transient reason and you don't want to make a no-op
 * commit. Resolves the requested branch (or the repo's default branch)
 * to the current ref and dispatches the runner.
 *
 * Fire-and-forget: returns immediately with the new run's id; the
 * dashboard polls / refreshes to see the result.
 */
export async function POST(req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  try {
    assertCanDispatchRun(repo.owner);
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(
        {
          error: e.message,
          code: "QUOTA_EXCEEDED",
          quota: e.quota,
          limit: e.limit,
          observed: e.observed,
        },
        { status: 429 },
      );
    }
    throw e;
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — default to repo's default branch */
  }
  const requestedBranch = (body as Record<string, unknown>)?.branch;
  const branch =
    typeof requestedBranch === "string" && requestedBranch.length > 0
      ? requestedBranch
      : repo.defaultBranch;

  const bare = repoPath(repo.owner, repo.name);
  const sha = await resolveRef(bare, `refs/heads/${branch}`);
  if (!sha) {
    return NextResponse.json(
      {
        error: `branch ${JSON.stringify(branch)} has no commits; push something first`,
      },
      { status: 400 },
    );
  }
  const ref = `refs/heads/${branch}`;

  // Fire-and-forget; surface the run id so the client can navigate to it.
  // We don't `await` the runner — manual triggers are explicitly async to
  // mirror the push-driven path.
  const runPromise = runWorkflow({ repoId: repo.id, ref, branch }).catch((err) => {
    console.error(`[manual-run] failed for ${owner}/${name}@${branch}:`, err);
    return null;
  });

  // We DO await briefly here so we can return the run id of the row the
  // runner just inserted. The runner inserts the row before doing any
  // real work, so this resolves quickly.
  const run = await Promise.race([
    runPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);

  return NextResponse.json({
    ok: true,
    branch,
    ref,
    sha,
    runId: run?.id ?? null,
    hint:
      run === null
        ? "run dispatched but did not finish within the response window — check /repos/{owner}/{repo}/runs"
        : `run #${run.id} ${run.status}`,
  });
}

function resolveRef(bareRepoPath: string, ref: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", [
      `--git-dir=${bareRepoPath}`,
      "rev-parse",
      "--verify",
      "--quiet",
      ref,
    ]);
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? stdout.trim() : null));
  });
}
