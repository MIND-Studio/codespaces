import "server-only";
import { getDb } from "@/lib/registry/db";

export type AgentRunStatus = "running" | "ok" | "error";

export type AgentRun = {
  id: number;
  repoId: number;
  issueId: number | null;
  eventType: string;
  role: string;
  driver: string;
  status: AgentRunStatus;
  summary: string;
  errorMessage: string | null;
  logPath: string | null;
  createdAt: number;
};

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    id: row.id as number,
    repoId: row.repo_id as number,
    issueId: (row.issue_id as number | null) ?? null,
    eventType: row.event_type as string,
    role: row.role as string,
    driver: row.driver as string,
    status: row.status as AgentRunStatus,
    summary: row.summary as string,
    errorMessage: (row.error_message as string | null) ?? null,
    logPath: (row.log_path as string | null) ?? null,
    createdAt: row.created_at as number,
  };
}

/**
 * Open a new run row in the `running` state and assign it a log file.
 * The driver writes to that file as the underlying tool produces output;
 * the row is closed by `finishAgentRun`.
 */
export function createAgentRun(input: {
  repoId: number;
  issueId: number | null;
  eventType: string;
  role: string;
  driver: string;
}): AgentRun {
  const info = getDb()
    .prepare(
      `INSERT INTO agent_runs
        (repo_id, issue_id, event_type, role, driver, status, summary, error_message, log_path, created_at)
       VALUES (?, ?, ?, ?, ?, 'running', '', NULL, NULL, ?)`,
    )
    .run(
      input.repoId,
      input.issueId,
      input.eventType,
      input.role,
      input.driver,
      Date.now(),
    );
  const id = info.lastInsertRowid as number;
  // Derive the log path from the id so multiple runs in flight at once
  // can never collide on the file.
  const logPath = `${id}.log`;
  getDb()
    .prepare("UPDATE agent_runs SET log_path = ? WHERE id = ?")
    .run(logPath, id);
  const row = getDb()
    .prepare("SELECT * FROM agent_runs WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return rowToRun(row);
}

/**
 * Close a run row with its final status and summary. Idempotent — calling
 * it on an already-finished row just overwrites the same fields.
 */
export function finishAgentRun(
  id: number,
  input: {
    status: "ok" | "error";
    summary: string;
    errorMessage?: string | null;
  },
): AgentRun | null {
  getDb()
    .prepare(
      `UPDATE agent_runs
       SET status = ?, summary = ?, error_message = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.summary.slice(0, 4000),
      input.errorMessage ?? null,
      id,
    );
  const row = getDb()
    .prepare("SELECT * FROM agent_runs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function getAgentRun(id: number): AgentRun | null {
  const row = getDb()
    .prepare("SELECT * FROM agent_runs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function listAgentRunsForIssue(issueId: number, limit = 20): AgentRun[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_runs WHERE issue_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(issueId, limit) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function listAgentRunsForRepo(repoId: number, limit = 50): AgentRun[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_runs WHERE repo_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(repoId, limit) as Record<string, unknown>[];
  return rows.map(rowToRun);
}
