import "server-only";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { getRepoById, type PagesConfig, type Repo } from "@/lib/registry/repos";
import {
  getPullRequest,
  updatePullPreview,
  type PullRequest,
} from "@/lib/registry/pulls";
import { repoPath, readBranchHead } from "@/lib/git/backend";
import { checkoutBranchToTempDir } from "@/lib/git/checkout";
import { parseWorkflow } from "@/lib/workflows/parse";
import { resolveRunnerMode, runShellBatch } from "@/lib/workflows/docker";
import { publishDirectory } from "@/lib/pages/publisher";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

// Same location agent-run logs use (dispatch.ts owns the const, but importing
// it here would create a cycle: dispatch.ts → preview.ts → dispatch.ts).
const AGENT_LOGS_DIR =
  process.env.AGENT_LOGS_DIR ?? path.join(process.cwd(), ".agent-logs");

/**
 * PR previews. A PR's source branch is built (if it ships a
 * `.mind/workflow.yml`) and published as a STATIC site into a per-PR pod
 * container, so the result is viewable before merge — the same publisher
 * the main Pages flow uses, just pointed at a `public/previews/...` target.
 *
 * Static-only by design: a pod is static file hosting, so apps must be
 * statically exportable (Vite `base:'./'` → dist, Next `output:'export'` →
 * out). There is no server-runtime preview tier.
 *
 * We compose the workflow runner's lower-level pieces
 * (checkout + parse + runShellBatch) rather than calling `runWorkflow`,
 * because that publishes to the repo's MAIN target; previews need a
 * distinct container per PR.
 */

const WORKFLOW_REL = ".mind/workflow.yml";

/** Pod container a PR's preview is published to (under /public → public-read). */
export function previewContainerFor(repo: Repo, pullNumber: number): string {
  const base = repo.ownerPodRoot.endsWith("/")
    ? repo.ownerPodRoot
    : `${repo.ownerPodRoot}/`;
  return `${base}public/previews/${repo.name}/${pullNumber}/`;
}

/** A throwaway PagesConfig so `publishDirectory` targets the preview container. */
function previewPages(repoId: number, target: string): PagesConfig {
  return {
    repoId,
    enabled: true,
    sourceBranch: "",
    sourcePath: "/",
    targetContainer: target,
    lastPublishedAt: null,
    lastPublishStatus: null,
    lastPublishError: null,
    lastPublishAttempt: null,
    lastPublishedSha: null,
  };
}

async function openLog(logPath: string): Promise<WriteStream> {
  await mkdir(path.dirname(logPath), { recursive: true });
  // Truncate: each preview build is a fresh log.
  return createWriteStream(logPath, { flags: "w" });
}

/**
 * Build (if needed) and publish a PR's preview. Idempotent and SHA-guarded:
 * a `ready` preview already at the branch tip is a no-op. Safe to call
 * fire-and-forget — all outcomes are persisted to the PR's preview_* fields.
 */
export async function buildAndPublishPreview(pull: PullRequest): Promise<void> {
  const repo = getRepoById(pull.repoId);
  if (!repo) return;

  const liveSha =
    (await readBranchHead(repo.owner, repo.name, pull.sourceBranch).catch(
      () => null,
    )) ?? pull.sourceSha;

  // SHA-guard — don't rebuild an unchanged branch that's already live.
  // The POST route optimistically marks "building" before this runs, so
  // re-assert the ready row instead of leaving the PR stuck on it.
  if (pull.previewStatus === "ready" && pull.previewSha === liveSha) {
    updatePullPreview(pull.id, { status: "ready", error: null });
    return;
  }

  const logName = `pr-${pull.number}-preview.log`;
  const logPath = path.join(AGENT_LOGS_DIR, logName);
  const stream = await openLog(logPath);
  const log = (line: string) => stream.write(`${line}\n`);

  updatePullPreview(pull.id, {
    status: "building",
    logPath: logName,
    error: null,
  });

  let cleanup: (() => Promise<void>) | null = null;
  try {
    log(
      `[preview] ${repo.owner}/${repo.name} PR #${pull.number} ` +
        `branch=${pull.sourceBranch} sha=${liveSha.slice(0, 8)}`,
    );
    const checkout = await checkoutBranchToTempDir(
      repoPath(repo.owner, repo.name),
      pull.sourceBranch,
    );
    cleanup = checkout.cleanup;
    const { tempDir } = checkout;

    // Tier 2 (build) if a workflow exists; else Tier 1 (static, instant).
    let publishDir = tempDir;
    const wfSource = await readFile(
      path.join(tempDir, WORKFLOW_REL),
      "utf-8",
    ).catch(() => null);
    if (wfSource !== null) {
      const wf = parseWorkflow(wfSource);
      const mode = await resolveRunnerMode();
      log(`[preview] building (.mind/workflow.yml, runner=${mode})`);
      const res = await runShellBatch({
        commands: wf.run,
        cwd: tempDir,
        timeoutMs: wf.timeoutMs,
        mode,
      });
      stream.write(res.log);
      if (res.exitCode !== 0) {
        throw new Error(`build failed (exit ${res.exitCode})`);
      }
      publishDir = wf.publish ? safeJoin(tempDir, wf.publish) : tempDir;
    } else {
      log("[preview] static site (no .mind/workflow.yml) — publishing as-is");
    }

    const target = previewContainerFor(repo, pull.number);
    log(`[preview] publishing ${publishDir} -> ${target}`);
    const result = await publishDirectory({
      repo,
      pages: previewPages(repo.id, target),
      sourceDir: publishDir,
    });

    // Deep-link index.html only when the publish root actually has one —
    // otherwise point at the container (the pod renders a browsable listing)
    // instead of a guaranteed 404.
    const hasIndex = await stat(path.join(publishDir, "index.html"))
      .then((s) => s.isFile())
      .catch(() => false);
    const url = hasIndex ? `${target}index.html` : target;
    updatePullPreview(pull.id, {
      status: "ready",
      url,
      sha: liveSha,
      error: null,
    });
    log(
      `[preview] ready: ${url} (uploaded ${result.uploaded})` +
        (hasIndex ? "" : " — no index.html at publish root, linking container"),
    );
  } catch (err) {
    const message =
      err instanceof OwnerFetchUnavailableError &&
      err.reason === "needs-reauthorization"
        ? "preview failed: reconnect your pod at /connect"
        : err instanceof Error
          ? err.message
          : String(err);
    updatePullPreview(pull.id, { status: "failed", error: message });
    log(`[preview] failed: ${message}`);
  } finally {
    await new Promise<void>((res) => stream.end(res));
    if (cleanup) await cleanup().catch(() => {});
  }
}

/**
 * Tear down a PR's published preview (on merge/close). Reuses the
 * publisher's prune step: publishing an EMPTY directory to the preview
 * container deletes every file in it. Best-effort — failures are swallowed.
 */
export async function deletePreview(pull: PullRequest): Promise<void> {
  const repo = getRepoById(pull.repoId);
  if (!repo) return;
  const target = previewContainerFor(repo, pull.number);
  const emptyDir = await mkdtemp(path.join(tmpdir(), "mind-preview-empty-"));
  try {
    await publishDirectory({
      repo,
      pages: previewPages(repo.id, target),
      sourceDir: emptyDir,
    });
  } catch {
    /* best-effort: a stale preview that can't be deleted is harmless */
  } finally {
    await rm(emptyDir, { recursive: true, force: true }).catch(() => {});
  }
  updatePullPreview(pull.id, {
    status: null,
    url: null,
    sha: null,
    error: null,
  });
}

/** Build a preview for (repoId, prNumber) by id — convenience for triggers. */
export async function buildPreviewForPull(
  repoId: number,
  prNumber: number,
): Promise<void> {
  const pull = getPullRequest(repoId, prNumber);
  if (pull) await buildAndPublishPreview(pull);
}

function safeJoin(base: string, rel: string): string {
  // parseWorkflow already rejects leading "/" and ".." in `publish`, but
  // re-check the resolved path stays inside the checkout.
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`publish dir escapes the checkout: ${rel}`);
  }
  return resolved;
}
