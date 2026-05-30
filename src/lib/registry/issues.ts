import "server-only";
import { getDb } from "@/lib/registry/db";
import { RegistryError } from "@/lib/registry/repos";

export type IssueStatus = "open" | "closed";
export type IssuePriority = "low" | "normal" | "high";

export type Issue = {
  id: number;
  repoId: number;
  number: number;
  title: string;
  body: string;
  status: IssueStatus;
  priority: IssuePriority;
  authorWebId: string;
  labels: string[];
  podUrl: string;
  createdAt: number;
  updatedAt: number;
};

export type IssueComment = {
  id: number;
  issueId: number;
  authorWebId: string;
  body: string;
  podUrl: string;
  /** Set when the comment was authored by an agent run (the coder).
   *  Null for human comments. The dispatcher uses this to skip
   *  re-firing the coder on its own comments, and the UI uses it to
   *  render an agent badge. */
  agentRunId: number | null;
  createdAt: number;
};

function rowToIssue(row: Record<string, unknown>): Issue {
  const labels = (row.labels as string).trim();
  return {
    id: row.id as number,
    repoId: row.repo_id as number,
    number: row.number as number,
    title: row.title as string,
    body: row.body as string,
    status: row.status as IssueStatus,
    priority: row.priority as IssuePriority,
    authorWebId: row.author_webid as string,
    labels: labels === "" ? [] : labels.split(",").filter(Boolean),
    podUrl: row.pod_url as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function rowToComment(row: Record<string, unknown>): IssueComment {
  return {
    id: row.id as number,
    issueId: row.issue_id as number,
    authorWebId: row.author_webid as string,
    body: row.body as string,
    podUrl: row.pod_url as string,
    agentRunId: (row.agent_run_id as number | null) ?? null,
    createdAt: row.created_at as number,
  };
}

function normaliseLabels(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new RegistryError("labels must be an array of strings", "INVALID_INPUT");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      throw new RegistryError("labels must be an array of strings", "INVALID_INPUT");
    }
    const norm = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!norm) continue;
    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(norm)) {
      throw new RegistryError(
        `invalid label ${JSON.stringify(raw)}`,
        "INVALID_INPUT",
      );
    }
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Allocate the next per-repo issue number and insert the row. The pod
 * URL is computed by the caller (it depends on the repo's pod root) and
 * passed in.
 */
export function createIssue(input: {
  repoId: number;
  title: string;
  body?: string;
  priority?: IssuePriority;
  labels?: string[];
  authorWebId: string;
  podUrl: string;
}): Issue {
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    throw new RegistryError("title must be a non-empty string", "INVALID_INPUT");
  }
  if (input.title.length > 200) {
    throw new RegistryError("title must be 200 chars or fewer", "INVALID_INPUT");
  }
  const priority: IssuePriority = input.priority ?? "normal";
  if (!["low", "normal", "high"].includes(priority)) {
    throw new RegistryError("priority must be low|normal|high", "INVALID_INPUT");
  }
  const labels = normaliseLabels(input.labels);

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction(() => {
    const next = db
      .prepare(
        "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE repo_id = ?",
      )
      .get(input.repoId) as { n: number };

    const info = db
      .prepare(
        `INSERT INTO issues
          (repo_id, number, title, body, status, priority,
           author_webid, labels, pod_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.repoId,
        next.n,
        input.title.trim(),
        input.body ?? "",
        priority,
        input.authorWebId,
        labels.join(","),
        input.podUrl,
        now,
        now,
      );
    return info.lastInsertRowid as number;
  });

  const id = tx();
  return getIssueById(id)!;
}

export function getIssueById(id: number): Issue | null {
  const row = getDb()
    .prepare("SELECT * FROM issues WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToIssue(row) : null;
}

export function getIssueByNumber(repoId: number, number: number): Issue | null {
  const row = getDb()
    .prepare("SELECT * FROM issues WHERE repo_id = ? AND number = ?")
    .get(repoId, number) as Record<string, unknown> | undefined;
  return row ? rowToIssue(row) : null;
}

export function listIssues(
  repoId: number,
  opts: { status?: IssueStatus | "all"; limit?: number } = {},
): Issue[] {
  const status = opts.status ?? "open";
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows =
    status === "all"
      ? getDb()
          .prepare(
            `SELECT * FROM issues WHERE repo_id = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(repoId, limit)
      : getDb()
          .prepare(
            `SELECT * FROM issues WHERE repo_id = ? AND status = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(repoId, status, limit);
  return (rows as Record<string, unknown>[]).map(rowToIssue);
}

export function countIssuesByStatus(repoId: number): {
  open: number;
  closed: number;
} {
  const rows = getDb()
    .prepare(
      "SELECT status, COUNT(*) AS n FROM issues WHERE repo_id = ? GROUP BY status",
    )
    .all(repoId) as { status: string; n: number }[];
  const out = { open: 0, closed: 0 };
  for (const r of rows) {
    if (r.status === "open") out.open = r.n;
    else if (r.status === "closed") out.closed = r.n;
  }
  return out;
}

export function updateIssue(
  id: number,
  patch: {
    status?: IssueStatus;
    priority?: IssuePriority;
    labels?: string[];
    title?: string;
    body?: string;
  },
): Issue {
  const current = getIssueById(id);
  if (!current) throw new RegistryError("issue not found", "NOT_FOUND");

  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) {
    if (!["open", "closed"].includes(patch.status)) {
      throw new RegistryError("status must be open|closed", "INVALID_INPUT");
    }
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.priority !== undefined) {
    if (!["low", "normal", "high"].includes(patch.priority)) {
      throw new RegistryError("priority must be low|normal|high", "INVALID_INPUT");
    }
    fields.push("priority = ?");
    values.push(patch.priority);
  }
  if (patch.labels !== undefined) {
    const labels = normaliseLabels(patch.labels);
    fields.push("labels = ?");
    values.push(labels.join(","));
  }
  if (patch.title !== undefined) {
    if (typeof patch.title !== "string" || patch.title.trim().length === 0) {
      throw new RegistryError("title must be a non-empty string", "INVALID_INPUT");
    }
    if (patch.title.length > 200) {
      throw new RegistryError("title must be 200 chars or fewer", "INVALID_INPUT");
    }
    fields.push("title = ?");
    values.push(patch.title.trim());
  }
  if (patch.body !== undefined) {
    if (typeof patch.body !== "string") {
      throw new RegistryError("body must be a string", "INVALID_INPUT");
    }
    fields.push("body = ?");
    values.push(patch.body);
  }

  if (fields.length === 0) return current;

  fields.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);

  getDb()
    .prepare(`UPDATE issues SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);

  return getIssueById(id)!;
}

export function addComment(input: {
  issueId: number;
  authorWebId: string;
  body: string;
  podUrl: string;
  agentRunId?: number | null;
}): IssueComment {
  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    throw new RegistryError("body must be a non-empty string", "INVALID_INPUT");
  }

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO issue_comments
          (issue_id, author_webid, body, pod_url, agent_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.issueId,
        input.authorWebId,
        input.body,
        input.podUrl,
        input.agentRunId ?? null,
        now,
      );

    db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(
      now,
      input.issueId,
    );

    return info.lastInsertRowid as number;
  });

  const id = tx();
  const row = db
    .prepare("SELECT * FROM issue_comments WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return rowToComment(row);
}

/**
 * Patch the canonical pod URL onto an issue after the per-repo number
 * has been allocated. Used by the create-issue route, which needs the
 * number (from the row insert) before it can compute the pod URL.
 */
export function setIssuePodUrl(id: number, podUrl: string): void {
  getDb()
    .prepare("UPDATE issues SET pod_url = ? WHERE id = ?")
    .run(podUrl, id);
}

export function setCommentPodUrl(id: number, podUrl: string): void {
  getDb()
    .prepare("UPDATE issue_comments SET pod_url = ? WHERE id = ?")
    .run(podUrl, id);
}

export function countComments(issueId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM issue_comments WHERE issue_id = ?")
    .get(issueId) as { n: number };
  return row.n;
}

export function listComments(issueId: number): IssueComment[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC",
    )
    .all(issueId) as Record<string, unknown>[];
  return rows.map(rowToComment);
}
