import "server-only";
import {
  getPagesConfig,
  listRepos,
  type Repo,
} from "@/lib/registry/repos";
import { readBranchHead } from "@/lib/git/backend";
import { publishPages } from "@/lib/pages/publisher";

/**
 * P0-R4 — HEAD-vs-last_published_sha reconciler.
 *
 * The post-receive hook is best-effort: a `git push` succeeds the
 * moment git-receive-pack finishes, but the callback that fires the
 * publisher can be lost (bridge crash, transient 5xx, hook rewritten by
 * a manual repo restore). The bare repo's HEAD then advances silently
 * and the pod stays on stale content.
 *
 * This module walks every Pages-enabled repo, reads HEAD of its
 * `sourceBranch`, and compares to `last_published_sha`. Drift → schedule
 * a publish via the existing publisher. Runs on boot (catches drift
 * accumulated during downtime) and on a timer (catches drift accumulated
 * between hook failures).
 *
 * Idempotent. Single in-flight reconciler per process (a re-entry while
 * a pass is running returns the same Promise). Publishes are serialised
 * inside `publishPages` via the per-repo lock from `publish-lock.ts`, so
 * the reconciler stays correct even if the timer overlaps a hook-driven
 * publish.
 */

const RECONCILE_INTERVAL_MS = (() => {
  const raw = process.env.MIND_RECONCILE_INTERVAL_MS;
  const n = raw ? Number(raw) : 5 * 60 * 1000; // 5 minutes
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
})();

export type ReconcileOutcome = {
  repo: string; // "owner/name"
  status:
    | "skipped-pages-disabled"
    | "skipped-no-target"
    | "skipped-no-head"
    | "in-sync"
    | "republished"
    | "failed";
  headSha?: string | null;
  publishedSha?: string | null;
  error?: string;
};

let inFlight: Promise<ReconcileOutcome[]> | null = null;

export function reconcilePages(): Promise<ReconcileOutcome[]> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const repos = listRepos();
      const outcomes: ReconcileOutcome[] = [];
      for (const repo of repos) {
        outcomes.push(await reconcileOne(repo));
      }
      const driftCount = outcomes.filter(
        (o) => o.status === "republished",
      ).length;
      const failureCount = outcomes.filter((o) => o.status === "failed").length;
      if (driftCount > 0 || failureCount > 0) {
        console.log(
          `[reconciler] pass complete — ${repos.length} repo(s), drift=${driftCount}, failures=${failureCount}`,
        );
      }
      return outcomes;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function reconcileOne(repo: Repo): Promise<ReconcileOutcome> {
  const tag = `${repo.owner}/${repo.name}`;
  const pages = getPagesConfig(repo.id);
  if (!pages || !pages.enabled) {
    return { repo: tag, status: "skipped-pages-disabled" };
  }
  if (!pages.targetContainer) {
    return { repo: tag, status: "skipped-no-target" };
  }

  let headSha: string | null;
  try {
    headSha = await readBranchHead(repo.owner, repo.name, pages.sourceBranch);
  } catch (e) {
    return {
      repo: tag,
      status: "failed",
      error: `readBranchHead: ${(e as Error).message ?? String(e)}`,
    };
  }
  if (!headSha) {
    // Branch never created (newly initialised repo). Nothing to publish.
    return { repo: tag, status: "skipped-no-head" };
  }

  if (pages.lastPublishedSha === headSha) {
    return {
      repo: tag,
      status: "in-sync",
      headSha,
      publishedSha: pages.lastPublishedSha,
    };
  }

  console.log(
    `[reconciler] drift detected ${tag}: HEAD=${headSha.slice(0, 8)} published=${
      pages.lastPublishedSha ? pages.lastPublishedSha.slice(0, 8) : "none"
    } — republishing`,
  );
  try {
    await publishPages(repo.id);
    return {
      repo: tag,
      status: "republished",
      headSha,
      publishedSha: pages.lastPublishedSha,
    };
  } catch (e) {
    // The publisher writes its own `markPagesFailed` row before throwing;
    // we just surface the outcome to the caller.
    return {
      repo: tag,
      status: "failed",
      headSha,
      publishedSha: pages.lastPublishedSha,
      error: (e as Error).message ?? String(e),
    };
  }
}

let timerStarted = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic reconciler. Idempotent (a second call is a no-op).
 * Runs one pass immediately, then every RECONCILE_INTERVAL_MS. The Next
 * dev server reloads modules between requests in dev, so this is the
 * mechanism — exported as `startReconciler` — that should be invoked
 * from a server bootstrap (e.g. agents-bootstrap or a small lazy init
 * inside an API route).
 *
 * In dev we deliberately do NOT auto-start on module load — that would
 * fire a publish on every HMR cycle. Instead the bootstrap module gates
 * it on NODE_ENV === "production" || MIND_FORCE_RECONCILER === "1".
 */
export function startReconciler(): void {
  if (timerStarted) return;
  timerStarted = true;
  console.log(
    `[reconciler] starting — interval=${RECONCILE_INTERVAL_MS}ms`,
  );
  // Kick off the first pass async so the bootstrap doesn't block on it.
  void reconcilePages().catch((e) =>
    console.warn(`[reconciler] initial pass failed:`, e),
  );
  timer = setInterval(() => {
    void reconcilePages().catch((e) =>
      console.warn(`[reconciler] pass failed:`, e),
    );
  }, RECONCILE_INTERVAL_MS);
  // Allow the process to exit cleanly during dev / scripts.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  timerStarted = false;
}
