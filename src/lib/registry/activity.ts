import "server-only";
import { getDb } from "@/lib/registry/db";

export type ActivityKind =
  | "repo.created"
  | "issue.opened"
  | "issue.commented"
  | "pull.opened"
  | "pull.merged"
  | "agent.ran";

export type ActivityItem = {
  kind: ActivityKind;
  ts: number;
  /** Repo coordinates so the UI can build the right URL. */
  repoOwner: string;
  repoName: string;
  /** A short label rendered as the headline. */
  title: string;
  /** Optional secondary line (e.g. issue body excerpt, agent summary). */
  detail: string | null;
  /** Routes to the relevant detail page. */
  href: string;
};

/**
 * Build a unified, chronologically-sorted activity feed for one WebID.
 *
 * Sources:
 *   - repos owned (created_at)
 *   - issues authored OR on owned repos (opened, commented)
 *   - pull requests authored OR on owned repos (opened, merged)
 *   - agent runs on owned repos
 *
 * The feed is best-effort — every source is independent, so dropping any
 * one of them (e.g. wiping the DB) leaves the others working.
 *
 * Time-ordered, capped at `limit` items so the profile page can render
 * without paging. Bumped this up cap means more SQL work; the per-source
 * LIMIT keeps the joined cost bounded.
 */
export function listActivityForWebId(
  webId: string,
  limit = 25,
): ActivityItem[] {
  const db = getDb();
  const perSourceCap = limit;
  const items: ActivityItem[] = [];

  // Repos this user owns. We need them anyway for the joined feeds, and
  // their creation is itself an activity event.
  const ownedRepos = db
    .prepare(
      `SELECT id, owner, name, created_at FROM repos
       WHERE owner_webid = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(webId, perSourceCap) as {
    id: number;
    owner: string;
    name: string;
    created_at: number;
  }[];
  for (const r of ownedRepos) {
    items.push({
      kind: "repo.created",
      ts: r.created_at,
      repoOwner: r.owner,
      repoName: r.name,
      title: `Created repo ${r.owner}/${r.name}`,
      detail: null,
      href: `/repos/${r.owner}/${r.name}`,
    });
  }

  const ownedRepoIds = ownedRepos.map((r) => r.id);
  // Conditional IN list. Avoid an empty `()` which is a syntax error.
  const inClause = ownedRepoIds.length > 0
    ? `(${ownedRepoIds.map(() => "?").join(",")})`
    : "(NULL)";

  // Issues — authored OR on user's repos.
  const issueRows = db
    .prepare(
      `SELECT i.number, i.title, i.body, i.author_webid, i.created_at,
              r.owner AS repo_owner, r.name AS repo_name
         FROM issues i
         JOIN repos  r ON r.id = i.repo_id
        WHERE i.author_webid = ? OR i.repo_id IN ${inClause}
     ORDER BY i.created_at DESC LIMIT ?`,
    )
    .all(webId, ...ownedRepoIds, perSourceCap) as {
    number: number;
    title: string;
    body: string;
    author_webid: string;
    created_at: number;
    repo_owner: string;
    repo_name: string;
  }[];
  for (const row of issueRows) {
    const youAuthored = row.author_webid === webId;
    items.push({
      kind: "issue.opened",
      ts: row.created_at,
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      title: youAuthored
        ? `Opened issue #${row.number} in ${row.repo_owner}/${row.repo_name}: ${row.title}`
        : `Issue #${row.number} filed on ${row.repo_owner}/${row.repo_name}: ${row.title}`,
      detail: excerpt(row.body),
      href: `/repos/${row.repo_owner}/${row.repo_name}/issues/${row.number}`,
    });
  }

  // Issue comments authored by user (on any repo).
  const commentRows = db
    .prepare(
      `SELECT c.body, c.created_at, i.number AS issue_number,
              r.owner AS repo_owner, r.name AS repo_name
         FROM issue_comments c
         JOIN issues i ON i.id = c.issue_id
         JOIN repos  r ON r.id = i.repo_id
        WHERE c.author_webid = ?
     ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(webId, perSourceCap) as {
    body: string;
    created_at: number;
    issue_number: number;
    repo_owner: string;
    repo_name: string;
  }[];
  for (const row of commentRows) {
    items.push({
      kind: "issue.commented",
      ts: row.created_at,
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      title: `Commented on ${row.repo_owner}/${row.repo_name}#${row.issue_number}`,
      detail: excerpt(row.body),
      href: `/repos/${row.repo_owner}/${row.repo_name}/issues/${row.issue_number}`,
    });
  }

  // Pull requests — authored OR on user's repos. Each PR can produce up
  // to two events: opened, merged.
  const prRows = db
    .prepare(
      `SELECT p.number, p.title, p.author_web_id, p.created_at, p.merged_at,
              p.status, r.owner AS repo_owner, r.name AS repo_name
         FROM pull_requests p
         JOIN repos r ON r.id = p.repo_id
        WHERE p.author_web_id = ? OR p.repo_id IN ${inClause}
     ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(webId, ...ownedRepoIds, perSourceCap) as {
    number: number;
    title: string;
    author_web_id: string | null;
    created_at: number;
    merged_at: number | null;
    status: string;
    repo_owner: string;
    repo_name: string;
  }[];
  for (const row of prRows) {
    const youAuthored = row.author_web_id === webId;
    items.push({
      kind: "pull.opened",
      ts: row.created_at,
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      title: youAuthored
        ? `Opened pull #${row.number} in ${row.repo_owner}/${row.repo_name}: ${row.title}`
        : `Pull #${row.number} opened on ${row.repo_owner}/${row.repo_name}: ${row.title}`,
      detail: null,
      href: `/repos/${row.repo_owner}/${row.repo_name}/pulls/${row.number}`,
    });
    if (row.merged_at !== null) {
      items.push({
        kind: "pull.merged",
        ts: row.merged_at,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        title: `Merged pull #${row.number} into ${row.repo_owner}/${row.repo_name}: ${row.title}`,
        detail: null,
        href: `/repos/${row.repo_owner}/${row.repo_name}/pulls/${row.number}`,
      });
    }
  }

  // Agent runs on user's repos. (Agent runs aren't authored by the
  // user, but they're part of the user's project activity surface.)
  if (ownedRepoIds.length > 0) {
    const runRows = db
      .prepare(
        `SELECT a.id, a.role, a.driver, a.status, a.summary, a.created_at,
                a.issue_id, i.number AS issue_number,
                r.owner AS repo_owner, r.name AS repo_name
           FROM agent_runs a
           JOIN repos r ON r.id = a.repo_id
      LEFT JOIN issues i ON i.id = a.issue_id
          WHERE a.repo_id IN ${inClause}
       ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(...ownedRepoIds, perSourceCap) as {
      id: number;
      role: string;
      driver: string;
      status: string;
      summary: string;
      created_at: number;
      issue_id: number | null;
      issue_number: number | null;
      repo_owner: string;
      repo_name: string;
    }[];
    for (const row of runRows) {
      const issuePart = row.issue_number
        ? `#${row.issue_number}`
        : `repo`;
      items.push({
        kind: "agent.ran",
        ts: row.created_at,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        title: `Agent ${row.role} ran on ${row.repo_owner}/${row.repo_name} ${issuePart}`,
        detail: row.summary ? excerpt(row.summary) : null,
        href: row.issue_number
          ? `/repos/${row.repo_owner}/${row.repo_name}/issues/${row.issue_number}`
          : `/repos/${row.repo_owner}/${row.repo_name}`,
      });
    }
  }

  // Newest first, then cap.
  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, limit);
}

function excerpt(text: string, max = 140): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd() + "…";
}
