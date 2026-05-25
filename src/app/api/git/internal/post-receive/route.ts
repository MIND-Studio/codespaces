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
 * during `createBareRepo`. The hook is local to the box and:
 *   - sends the request from the loopback interface (enforced here by
 *     inspecting the forwarded-for / remote-address headers Caddy sets);
 *   - signs the JSON body with HMAC-SHA256 keyed by `BRIDGE_HOOK_SECRET`
 *     and puts the digest in `X-Bridge-Hmac: sha256=<hex>`.
 *
 * Both checks must pass before the publish chain runs. See P0-S3 in
 * docs/PRODUCTION-READINESS.md.
 */
export async function POST(req: Request) {
  const env = getEnv();
  const hdrs = await headers();

  // Loopback bind check. Behind Caddy on the prod stack, `X-Forwarded-For`
  // is the original remote address. In dev (`curl 127.0.0.1`) there is
  // no forwarded header, so we accept the connection unconditionally
  // when not behind a proxy — the HMAC carries the trust in that case.
  const forwardedFor = hdrs.get("x-forwarded-for");
  if (forwardedFor) {
    const remote = forwardedFor.split(",")[0]?.trim() ?? "";
    if (
      remote &&
      remote !== "127.0.0.1" &&
      remote !== "::1" &&
      remote !== "localhost"
    ) {
      return NextResponse.json(
        { error: "post-receive hook must originate from loopback" },
        { status: 403 },
      );
    }
  }

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
