import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { getRepo, getPagesConfig, validateName } from "@/lib/registry/repos";
import { publishPages } from "@/lib/pages/publisher";
import { runWorkflow } from "@/lib/workflows/runner";
import { getEnv } from "@/lib/env";
import {
  log,
  newCorrelationId,
  withCorrelationId,
} from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal endpoint called by the per-repo `post-receive` hook installed
 * during `createBareRepo`. The hook signs the JSON body with HMAC-SHA256
 * keyed by `BRIDGE_HOOK_SECRET` and puts the digest in
 * `X-Bridge-Hmac: sha256=<hex>`. The HMAC is the security gate: an
 * attacker without the secret cannot forge a valid request, and the
 * secret is server-only (env var, never in the repo).
 *
 * Previously this also enforced a loopback check via X-Forwarded-For,
 * but in production the hook calls the bridge by service name
 * (`http://bridge:3010/...`) and Next.js auto-populates X-Forwarded-For
 * from the peer's container IP for any non-loopback TCP peer. That
 * caused the check to reject every legitimate intra-container callback
 * with a 403, silently breaking workflow runs and Pages republishes.
 * The HMAC alone is the right boundary here.
 */
export async function POST(req: Request) {
  const env = getEnv();
  const hdrs = await headers();

  // Read body as text first so we can compute HMAC over the EXACT bytes
  // the hook signed (parsing → re-stringifying would mutate whitespace).
  const raw = await req.text();
  const headerSig = hdrs.get("x-bridge-hmac") ?? "";

  if (!verifyHmac(raw, headerSig, env.hookSecret)) {
    return NextResponse.json(
      { error: "invalid or missing X-Bridge-Hmac" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { owner, repo: name, ref, newRev } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof owner !== "string" ||
    typeof name !== "string" ||
    typeof ref !== "string"
  ) {
    return NextResponse.json(
      { error: "owner, repo, ref required" },
      { status: 400 },
    );
  }

  try {
    validateName(owner, "owner");
    validateName(name, "repo");
  } catch {
    return NextResponse.json({ error: "invalid owner/repo" }, { status: 400 });
  }

  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const pages = getPagesConfig(repo.id);

  // refs/heads/main → main
  const branch = ref.replace(/^refs\/heads\//, "");
  const branchMatches =
    pages?.enabled === true && pages.sourceBranch === branch;

  let scheduled: "workflow" | "legacy-pages" | "skipped" = "skipped";

  // Anchor a correlation id at the request boundary. The publish/run
  // chain below is fired async; we run it inside a withCorrelationId
  // scope so its log lines carry the same `cid` field as this request.
  const cid = newCorrelationId();
  return withCorrelationId(cid, () => {
    log.info("post_receive", {
      repo: `${owner}/${name}`,
      ref,
      newRev: typeof newRev === "string" ? newRev.slice(0, 8) : null,
    });

    if (branchMatches) {
      scheduled = "workflow";
      withCorrelationId(cid, () => {
        runWorkflow({ repoId: repo.id, ref, branch })
          .then((run) => {
            if (run === null) {
              if (pages && pages.targetContainer.length > 0) {
                return publishPages(repo.id);
              }
            }
            return undefined;
          })
          .catch((err) => {
            log.error("post_receive.chain_failed", {
              repo: `${owner}/${name}`,
              branch,
              error: (err as Error).message ?? String(err),
            });
          });
      });
    }

    return NextResponse.json({
      ok: true,
      repo: `${owner}/${name}`,
      ref,
      branch,
      publish: scheduled,
      cid,
    });
  });
}

function verifyHmac(body: string, headerValue: string, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(headerValue);
  if (!match) return false;
  const provided = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
