import { NextResponse } from "next/server";
import {
  createRepo,
  deleteRepoById,
  getPagesConfig,
  listRepos,
  RegistryError,
} from "@/lib/registry/repos";
import { createBareRepo } from "@/lib/git/backend";
import { writeRepoMetadata } from "@/lib/solid/repo-metadata";
import { requireSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { verifyPodRootForWebId } from "@/lib/solid/profile";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { jsonResponse } from "@/lib/http/json";
import {
  assertCanCreateRepo,
  QuotaExceededError,
} from "@/lib/registry/quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonResponse({ repos: listRepos() });
}

export async function POST(req: Request) {
  const limited = await rateLimit("repoCreate", RATE_LIMITS.repoCreate);
  if (limited) return limited;
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    owner,
    name,
    ownerWebId,
    ownerPodRoot,
    defaultBranch,
    visibility,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof owner !== "string" || typeof name !== "string") {
    return NextResponse.json(
      { error: "owner and name are required strings" },
      { status: 400 },
    );
  }
  if (typeof ownerWebId !== "string" || typeof ownerPodRoot !== "string") {
    return NextResponse.json(
      { error: "ownerWebId and ownerPodRoot are required strings" },
      { status: 400 },
    );
  }

  // The session establishes WHO is creating the repo; the request body MUST
  // match that identity. Otherwise an attacker with any valid session could
  // create a repo claiming someone else's WebID.
  if (ownerWebId !== auth.webId) {
    return NextResponse.json(
      { error: "ownerWebId must match the authenticated session", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  // P0-S5: the WebID's pod profile must advertise this podRoot as one of
  // its pim:storage locations. Otherwise an attacker can register a podRoot
  // they control alongside someone else's WebID. Skipped only when the
  // operator opts out (e.g. for offline tests).
  if (!getEnv().allowSeededFallback) {
    const verdict = await verifyPodRootForWebId(ownerWebId, ownerPodRoot);
    if (!verdict.ok) {
      return NextResponse.json(
        {
          error: `ownerPodRoot ${ownerPodRoot} is not advertised by WebID ${ownerWebId}`,
          code: "POD_ROOT_NOT_VERIFIED",
          detail: verdict.reason,
        },
        { status: 400 },
      );
    }
  }

  // Per-owner repo quota (§4 multi-user). Charged against the WebID's
  // observed `owner` slug, not the IP, so a single owner can't sidestep
  // by rotating clients.
  try {
    assertCanCreateRepo(owner);
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

  let repo;
  try {
    repo = createRepo({
      owner,
      name,
      ownerWebId,
      ownerPodRoot,
      defaultBranch:
        typeof defaultBranch === "string" ? defaultBranch : undefined,
      visibility:
        visibility === "private" || visibility === "public"
          ? visibility
          : undefined,
    });
  } catch (e) {
    if (e instanceof RegistryError) {
      const status = e.code === "ALREADY_EXISTS" ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error("[repos.POST] unexpected error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  // The registry row exists; now create the bare git repo on disk. Roll back
  // the registry row if that fails so the two stay consistent.
  try {
    await createBareRepo(repo.owner, repo.name);
  } catch (e) {
    deleteRepoById(repo.id);
    console.error("[repos.POST] failed to create bare repo:", e);
    return NextResponse.json(
      { error: "failed to create bare git repository" },
      { status: 500 },
    );
  }

  // Best-effort: publish a Turtle description of the repo into the owner's
  // pod under /codespaces/{name}/index.ttl so the pod itself advertises
  // the repo as Linked Data. Failure here does not fail repo creation —
  // the pod might be temporarily offline.
  writeRepoMetadata(repo, getPagesConfig(repo.id)).catch((err) => {
    console.warn(
      `[repos.POST] writeRepoMetadata for ${repo.owner}/${repo.name} failed:`,
      err,
    );
  });

  const env = getEnv();
  return NextResponse.json(
    {
      repo,
      cloneUrl: `${env.bridgePublicUrl}/api/git/${repo.owner}/${repo.name}.git`,
    },
    { status: 201 },
  );
}
