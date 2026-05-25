import "server-only";
import { getEnv } from "@/lib/env";
import { startReconciler } from "@/lib/pages/reconciler";
import { reapStuckRuns } from "@/lib/registry/runs";
import { log } from "@/lib/log";

/**
 * Cross-cutting server bootstrap. Idempotent (safe to call from any
 * server-only entry point). Today it covers:
 *   • Reconciler timer (P0-R4)
 *   • Stuck-run reaper (§3.4) — runs once at startup to fail any
 *     workflow_runs row stuck in `running` from a previous process
 *
 * Reconciler is gated so dev's HMR doesn't fire a publish on every
 * reload:
 *   • prod: always on
 *   • dev: only when MIND_FORCE_RECONCILER=1 is explicit
 *
 * The stuck-run reaper runs in every mode — it's a database operation,
 * doesn't fire side effects, and the worst case in dev is "an aborted
 * run gets a 'reaped' marker on the next dev restart."
 */

let booted = false;

export function ensureServerBootstrap(): void {
  if (booted) return;
  booted = true;

  const reaped = reapStuckRuns();
  if (reaped > 0) {
    log.warn("bootstrap.reaped_stuck_runs", { count: reaped });
  }

  const env = getEnv();
  if (env.isProd || process.env.MIND_FORCE_RECONCILER === "1") {
    startReconciler();
  }
}
