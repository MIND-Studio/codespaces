import { NextResponse } from "next/server";
import { getRepo, validateName, RegistryError } from "@/lib/registry/repos";
import { runGitHttpBackend } from "@/lib/git/http-cgi";
import { getRepoDiskBytes } from "@/lib/git/backend";
import { verifyPushToken } from "@/lib/registry/tokens";
import {
  isLockedOut,
  recordFailure,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { QUOTAS } from "@/lib/registry/quotas";
import { Metrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Without this, Next.js may try to revalidate or wrap the streaming Response
// in ways that break the Smart HTTP protocol.
export const fetchCache = "force-no-store";

type Params = {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
};

async function handle(req: Request, { params }: Params): Promise<Response> {
  const { owner, repo: repoSegment, path } = await params;

  // Git clients append `.git` to the repo name in the remote URL. Strip it
  // for the registry lookup; pass the suffixed form to git http-backend
  // (which expects a `*.git` directory under GIT_PROJECT_ROOT).
  const repoName = repoSegment.endsWith(".git")
    ? repoSegment.slice(0, -4)
    : repoSegment;

  try {
    validateName(owner, "owner");
    validateName(repoName, "repo");
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const repo = getRepo(owner, repoName);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  // Auth gate. We classify the request by its (subpath, query.service)
  // because git's Smart HTTP uses the same `/info/refs` endpoint for both
  // pull and push, distinguished by `?service=git-{upload,receive}-pack`.
  const url = new URL(req.url);
  const service = url.searchParams.get("service") ?? "";
  const lastSegment = Array.isArray(path) && path.length > 0 ? path[path.length - 1] : "";
  const isPush =
    lastSegment === "git-receive-pack" ||
    (lastSegment === "refs" && service === "git-receive-pack");
  const isPull =
    lastSegment === "git-upload-pack" ||
    (lastSegment === "refs" && service === "git-upload-pack");

  const requiresAuth = isPush || (isPull && repo.visibility === "private");
  if (requiresAuth) {
    // Brute-force throttle. Scope per-(repo, IP) so a lockout on repo A
    // doesn't deny service on repo B. The bucket counts FAILURES only;
    // a correct token burns no budget.
    const throttleScope = `gitPushAuthFailure:${repo.id}`;
    if (await isLockedOut(throttleScope, RATE_LIMITS.gitPushAuthFailure)) {
      if (isPush) Metrics.gitPush(owner, repoName, "rate-limited");
      else Metrics.gitClone(owner, repoName, "auth-failed");
      return new NextResponse(
        JSON.stringify({
          error: "too many failed authentication attempts; try again later",
          code: "AUTH_LOCKED",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
            "WWW-Authenticate": `Basic realm="${owner}/${repoName}"`,
          },
        },
      );
    }
    const presented = readBasicAuthPassword(req);
    if (!presented || !verifyPushToken(repo.id, presented)) {
      await recordFailure(throttleScope, RATE_LIMITS.gitPushAuthFailure);
      if (isPush) Metrics.gitPush(owner, repoName, "auth-failed");
      else Metrics.gitClone(owner, repoName, "auth-failed");
      console.warn(
        `[git.auth] failed Basic-auth for ${owner}/${repoName} (presented=${!!presented})`,
      );
      return new NextResponse(
        JSON.stringify({
          error: presented ? "invalid push token" : "missing push token",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Basic realm="${owner}/${repoName}"`,
          },
        },
      );
    }
  }

  // Per-repo disk quota (§4 multi-user). Pre-flight check on push only:
  // refuse if the bare repo's current on-disk size is already at or
  // above the cap. A push that would push it over the line during this
  // request still completes — accepting it lets the operator see the
  // breach in the next size sample; the NEXT push is the one that's
  // refused.
  if (isPush) {
    try {
      const bytes = await getRepoDiskBytes(owner, repoName);
      if (bytes >= QUOTAS.maxDiskPerRepoBytes) {
        Metrics.gitPush(owner, repoName, "quota-exceeded");
        return NextResponse.json(
          {
            error: `repo over disk quota (${bytes} / ${QUOTAS.maxDiskPerRepoBytes} bytes); delete history or contact the operator`,
            code: "QUOTA_EXCEEDED",
            quota: "maxDiskPerRepoBytes",
            limit: QUOTAS.maxDiskPerRepoBytes,
            observed: bytes,
          },
          { status: 413 },
        );
      }
    } catch (e) {
      console.warn(`[git.push] disk-quota probe failed for ${owner}/${repoName}:`, e);
      // Fail open on probe error — the operator's filesystem alert is
      // the backstop, not this check.
    }
  }

  // Reconstruct PATH_INFO for the CGI:
  // /alice/hello.git/info/refs   or   /alice/hello.git/git-upload-pack
  const trailing = Array.isArray(path) && path.length > 0 ? `/${path.join("/")}` : "";
  const pathInfo = `/${owner}/${repoName}.git${trailing}`;

  const res = await runGitHttpBackend(req, pathInfo);
  // Status alone is fuzzy for git Smart HTTP — the CGI streams a 200
  // even for some application-level errors — but it's enough for an ops
  // counter to spot a sudden 5xx spike. Push vs clone metric branches
  // on `isPush` so the dashboards stay separable.
  const result = res.ok ? "success" : "error";
  if (isPush) Metrics.gitPush(owner, repoName, result);
  else if (isPull) Metrics.gitClone(owner, repoName, result);
  return res;
}

/** Extract the password from an HTTP-Basic Authorization header. */
function readBasicAuthPassword(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    // Username is intentionally ignored — any user with a valid token wins.
    return decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

export const GET = handle;
export const POST = handle;
