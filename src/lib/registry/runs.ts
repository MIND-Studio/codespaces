import "server-only";
import { getDb } from "@/lib/registry/db";

export type RunStatus = "queued" | "running" | "success" | "failed" | "error";

export type WorkflowRun = {
  id: number;
  repoId: number;
  ref: string;
  status: RunStatus;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  logTail: string;
  errorMessage: string | null;
};

const LOG_TAIL_CAP = 64 * 1024;

function rowToRun(r: Record<string, unknown>): WorkflowRun {
  return {
    id: r.id as number,
    repoId: r.repo_id as number,
    ref: r.ref as string,
    status: r.status as RunStatus,
    exitCode: (r.exit_code as number | null) ?? null,
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number | null) ?? null,
    logTail: (r.log_tail as string) ?? "",
    errorMessage: (r.error_message as string | null) ?? null,
  };
}

export function createRun(repoId: number, ref: string): WorkflowRun {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO workflow_runs (repo_id, ref, status, started_at)
       VALUES (?, ?, 'queued', ?)`,
    )
    .run(repoId, ref, now);
  return getRunById(info.lastInsertRowid as number)!;
}

export function getRunById(id: number): WorkflowRun | null {
  const row = getDb().prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRun(row) : null;
}

export function getLatestRunForRepo(repoId: number): WorkflowRun | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM workflow_runs WHERE repo_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(repoId) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

/** Total workflow runs across all repos. Used by the landing-page tile. */
export function countAllRuns(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM workflow_runs").get() as { c: number };
  return row.c;
}

/** Most recent run across every repo, or null if nothing has run yet. */
export function getLatestRunOverall(): WorkflowRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 1`)
    .get() as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function listRunsForRepo(repoId: number, limit = 20): WorkflowRun[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM workflow_runs WHERE repo_id = ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(repoId, limit) as Record<string, unknown>[]
  ).map(rowToRun);
}

export function markRunRunning(id: number): void {
  getDb().prepare("UPDATE workflow_runs SET status='running' WHERE id = ?").run(id);
}

export function finishRun(
  id: number,
  input: {
    status: Exclude<RunStatus, "queued" | "running">;
    exitCode: number | null;
    log: string;
    errorMessage?: string | null;
  },
): void {
  const tail = truncateTail(input.log);
  getDb()
    .prepare(
      `UPDATE workflow_runs
         SET status=?, exit_code=?, finished_at=?, log_tail=?, error_message=?
       WHERE id = ?`,
    )
    .run(input.status, input.exitCode, Date.now(), tail, input.errorMessage ?? null, id);
}

function truncateTail(log: string): string {
  if (log.length <= LOG_TAIL_CAP) return log;
  return "… (truncated, showing last 64 KB) …\n" + log.slice(log.length - LOG_TAIL_CAP);
}

/**
 * Stuck-run reaper (§3.4). A crash between `markRunRunning` and
 * `finishRun` leaves a `workflow_runs` row in `running` indefinitely.
 * Called once at server bootstrap (`ensureServerBootstrap`): any row
 * with status='running' whose `started_at` is older than the current
 * process's start time can be safely marked failed — the process that
 * was supposed to finalise it is gone.
 *
 * Returns the count of rows reaped.
 */
export function reapStuckRuns(): number {
  const processStartMs = Date.now() - Math.round(process.uptime() * 1000);
  const info = getDb()
    .prepare(
      `UPDATE workflow_runs
         SET status = 'failed',
             finished_at = ?,
             error_message = COALESCE(error_message, 'reaped on bridge startup — previous process crashed mid-run')
       WHERE status = 'running' AND started_at < ?`,
    )
    .run(Date.now(), processStartMs);
  return info.changes;
}
