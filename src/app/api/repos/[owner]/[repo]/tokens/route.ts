import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { createPushToken, listPushTokens } from "@/lib/registry/tokens";
import { requireOwner } from "@/lib/auth/session";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  assertCanMintToken,
  QuotaExceededError,
} from "@/lib/registry/quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ tokens: listPushTokens(repo.id) });
}

export async function POST(req: Request, { params }: Params) {
  const limited = await rateLimit("tokenMint", RATE_LIMITS.tokenMint);
  if (limited) return limited;
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — label defaults to ""
  }
  const labelRaw = (body as Record<string, unknown>)?.label;
  const label = typeof labelRaw === "string" ? labelRaw.slice(0, 64) : "";
  try {
    assertCanMintToken(repo.id);
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
  const created = createPushToken(repo.id, label);
  return NextResponse.json(
    {
      ...created,
      hint:
        "Use this token as the HTTP-Basic password (any username) when pushing or, for private repos, when cloning. The plaintext is shown ONCE — store it now.",
    },
    { status: 201 },
  );
}
