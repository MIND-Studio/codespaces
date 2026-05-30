import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { getRepo } from "@/lib/registry/repos";
import { getPullRequest } from "@/lib/registry/pulls";
import { requireOwner, requireSession } from "@/lib/auth/session";
import { buildAndPublishPreview } from "@/lib/pages/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_LOGS_DIR =
  process.env.AGENT_LOGS_DIR ?? path.join(process.cwd(), ".agent-logs");

type Params = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

// `mutating` POSTs enforce CSRF (requireOwner); the GET poll is a read, so it
// only needs an owner session — CSRF on a GET would (and did) 403 the poller.
async function resolve(params: Params["params"], mutating: boolean) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return { error: NextResponse.json({ error: "invalid number" }, { status: 400 }) };
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return { error: NextResponse.json({ error: "repo not found" }, { status: 404 }) };
  }
  if (mutating) {
    const auth = await requireOwner(repo.ownerWebId);
    if (!auth.ok) return { error: auth.response };
  } else {
    const s = await requireSession({ skipCsrf: true });
    if (!s.ok) return { error: s.response };
    if (s.webId !== repo.ownerWebId) {
      return {
        error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      };
    }
  }
  const pull = getPullRequest(repo.id, number);
  if (!pull) {
    return { error: NextResponse.json({ error: "pull not found" }, { status: 404 }) };
  }
  return { repo, pull };
}

/** Rebuild this PR's preview (async). Returns immediately as `building`. */
export async function POST(_req: Request, { params }: Params) {
  const r = await resolve(params, true);
  if ("error" in r) return r.error;
  // Fire-and-forget: the build streams to the preview log and lands on the
  // PR's preview_* fields; the client polls GET for progress.
  void buildAndPublishPreview(r.pull).catch((e) =>
    console.warn(`[preview] PR #${r.pull.number} build failed to start:`, e),
  );
  return NextResponse.json({ status: "building" }, { status: 202 });
}

/** Poll a PR's preview status + build log. */
export async function GET(_req: Request, { params }: Params) {
  const r = await resolve(params, false);
  if ("error" in r) return r.error;
  const { pull } = r;
  let log = "";
  if (pull.previewLogPath) {
    log = await readFile(
      path.join(AGENT_LOGS_DIR, pull.previewLogPath),
      "utf-8",
    ).catch(() => "");
  }
  return NextResponse.json({
    status: pull.previewStatus,
    url: pull.previewUrl,
    error: pull.previewError,
    sha: pull.previewSha,
    log,
  });
}
