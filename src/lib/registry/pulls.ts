import "server-only";
import { getDb } from "@/lib/registry/db";
import { RegistryError } from "@/lib/registry/repos";

export type PullStatus = "open" | "merged" | "closed";

/** Lifecycle of a PR's static preview build. null = never built. */
export type PreviewStatus = "building" | "ready" | "failed";

export type PullRequest = {
  id: number;
  repoId: number;
  number: number;
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string;
  status: PullStatus;
  authorWebId: string | null;
  issueId: number | null;
  agentRunId: number | null;
  mergeSha: string | null;
  createdAt: number;
  updatedAt: number;
  mergedAt: number | null;
  closedAt: number | null;
  previewStatus: PreviewStatus | null;
  previewUrl: string | null;
  previewSha: string | null;
  previewLogPath: string | null;
  previewError: string | null;
};

function rowToPull(row: Record<string, unknown>): PullRequest {
  return {
    id: row.id as number,
    repoId: row.repo_id as number,
    number: row.number as number,
    title: row.title as string,
    body: row.body as string,
    sourceBranch: row.source_branch as string,
    targetBranch: row.target_branch as string,
    sourceSha: row.source_sha as string,
    status: row.status as PullStatus,
    authorWebId: (row.author_web_id as string | null) ?? null,
    issueId: (row.issue_id as number | null) ?? null,
    agentRunId: (row.agent_run_id as number | null) ?? null,
    mergeSha: (row.merge_sha as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    mergedAt: (row.merged_at as number | null) ?? null,
    closedAt: (row.closed_at as number | null) ?? null,
    previewStatus: (row.preview_status as PreviewStatus | null) ?? null,
    previewUrl: (row.preview_url as string | null) ?? null,
    previewSha: (row.preview_sha as string | null) ?? null,
    previewLogPath: (row.preview_log_path as string | null) ?? null,
    previewError: (row.preview_error as string | null) ?? null,
  };
}

/**
 * Open a PR if no `open` PR already targets the same source→target pair,
 * otherwise update the existing one's tip + summary in place. Returning
 * the row in either case keeps callers (e.g. the engineer driver) from
 * having to special-case "I just retried this issue".
 */
export function upsertPullRequest(input: {
  repoId: number;
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string;
  authorWebId?: string | null;
  issueId?: number | null;
  agentRunId?: number | null;
}): PullRequest {
  const db = getDb();
  const now = Date.now();

  const existing = db
    .prepare(
      `SELECT * FROM pull_requests
       WHERE repo_id = ? AND source_branch = ? AND target_branch = ? AND status = 'open'`,
    )
    .get(
      input.repoId,
      input.sourceBranch,
      input.targetBranch,
    ) as Record<string, unknown> | undefined;
  if (existing) {
    db.prepare(
      `UPDATE pull_requests
       SET title = ?, body = ?, source_sha = ?, updated_at = ?,
           agent_run_id = COALESCE(?, agent_run_id),
           issue_id = COALESCE(?, issue_id),
           author_web_id = COALESCE(?, author_web_id)
       WHERE id = ?`,
    ).run(
      input.title,
      input.body,
      input.sourceSha,
      now,
      input.agentRunId ?? null,
      input.issueId ?? null,
      input.authorWebId ?? null,
      existing.id as number,
    );
    const refreshed = db
      .prepare("SELECT * FROM pull_requests WHERE id = ?")
      .get(existing.id) as Record<string, unknown>;
    return rowToPull(refreshed);
  }

  const number = (
    db
      .prepare(
        "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM pull_requests WHERE repo_id = ?",
      )
      .get(input.repoId) as { n: number }
  ).n;

  const info = db
    .prepare(
      `INSERT INTO pull_requests
        (repo_id, number, title, body, source_branch, target_branch,
         source_sha, status, author_web_id, issue_id, agent_run_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.repoId,
      number,
      input.title,
      input.body,
      input.sourceBranch,
      input.targetBranch,
      input.sourceSha,
      input.authorWebId ?? null,
      input.issueId ?? null,
      input.agentRunId ?? null,
      now,
      now,
    );
  const row = db
    .prepare("SELECT * FROM pull_requests WHERE id = ?")
    .get(info.lastInsertRowid as number) as Record<string, unknown>;
  return rowToPull(row);
}

export function getPullRequest(
  repoId: number,
  number: number,
): PullRequest | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM pull_requests WHERE repo_id = ? AND number = ?",
    )
    .get(repoId, number) as Record<string, unknown> | undefined;
  return row ? rowToPull(row) : null;
}

export function listPullRequests(
  repoId: number,
  status?: PullStatus | "all",
): PullRequest[] {
  const filter = status && status !== "all" ? status : null;
  const rows = filter
    ? (getDb()
        .prepare(
          `SELECT * FROM pull_requests
           WHERE repo_id = ? AND status = ?
           ORDER BY created_at DESC`,
        )
        .all(repoId, filter) as Record<string, unknown>[])
    : (getDb()
        .prepare(
          `SELECT * FROM pull_requests
           WHERE repo_id = ?
           ORDER BY created_at DESC`,
        )
        .all(repoId) as Record<string, unknown>[]);
  return rows.map(rowToPull);
}

export function countOpenPullRequests(repoId: number): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM pull_requests WHERE repo_id = ? AND status = 'open'",
    )
    .get(repoId) as { n: number };
  return row.n;
}

export function countPullRequestsByStatus(
  repoId: number,
): { open: number; merged: number; closed: number } {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM pull_requests
       WHERE repo_id = ?
       GROUP BY status`,
    )
    .all(repoId) as Array<{ status: PullStatus; n: number }>;
  const out = { open: 0, merged: 0, closed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function listPullRequestsForIssue(issueId: number): PullRequest[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM pull_requests
       WHERE issue_id = ?
       ORDER BY created_at DESC`,
    )
    .all(issueId) as Record<string, unknown>[];
  return rows.map(rowToPull);
}

export function markPullRequestMerged(
  id: number,
  mergeSha: string,
): PullRequest {
  const now = Date.now();
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE pull_requests
       SET status = 'merged', merge_sha = ?, merged_at = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .run(mergeSha, now, now, id);
  if (info.changes === 0) {
    throw new RegistryError("pull request is not open", "INVALID_INPUT");
  }
  const row = db
    .prepare("SELECT * FROM pull_requests WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return rowToPull(row);
}

/**
 * Patch a PR's preview-build fields. Only the keys provided are written
 * (partial update), so a "building" transition needn't clear a prior URL
 * until the new build resolves. `updatedAt` is intentionally NOT bumped —
 * a preview rebuild is not a change to the PR itself.
 */
export function updatePullPreview(
  id: number,
  patch: {
    status?: PreviewStatus | null;
    url?: string | null;
    sha?: string | null;
    logPath?: string | null;
    error?: string | null;
  },
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("status" in patch) {
    sets.push("preview_status = ?");
    vals.push(patch.status ?? null);
  }
  if ("url" in patch) {
    sets.push("preview_url = ?");
    vals.push(patch.url ?? null);
  }
  if ("sha" in patch) {
    sets.push("preview_sha = ?");
    vals.push(patch.sha ?? null);
  }
  if ("logPath" in patch) {
    sets.push("preview_log_path = ?");
    vals.push(patch.logPath ?? null);
  }
  if ("error" in patch) {
    sets.push("preview_error = ?");
    vals.push(patch.error ?? null);
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb()
    .prepare(`UPDATE pull_requests SET ${sets.join(", ")} WHERE id = ?`)
    .run(...(vals as never[]));
}

export function closePullRequest(id: number): PullRequest {
  const now = Date.now();
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE pull_requests
       SET status = 'closed', closed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .run(now, now, id);
  if (info.changes === 0) {
    throw new RegistryError("pull request is not open", "INVALID_INPUT");
  }
  const row = db
    .prepare("SELECT * FROM pull_requests WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return rowToPull(row);
}
