import "server-only";
import { getDb } from "@/lib/registry/db";
import type { Repo } from "@/lib/registry/repos";
import { trackerContainerUrl } from "@/lib/solid/tracker-pod";
import type { Tracker } from "@/lib/tracker/model";

/**
 * Project a repo's `.mind`-derived `flow:Tracker` (read from the pod) into the
 * Registry `issues` index — MC-160's "the Registry index is rebuildable from
 * the pod tracker (projection, not source)."
 *
 * The pod tracker is the source of truth; this index exists only for fast
 * list/filter queries. Each tracker issue is upserted by its stable
 * `(repo_id, number)`, so re-running the projection reconstructs the
 * tracker-derived rows idempotently — wiping `.registry-data/` and re-projecting
 * yields the same index. Rows NOT carried by the tracker (e.g. the legacy flat
 * `issue.ttl` store kept for back-compat) are left untouched: the projection
 * adds/refreshes tracker rows, it does not own the whole table.
 *
 * The `pod_url` points at the issue's fragment in the pod `state.ttl`
 * (`{container}state.ttl#{id}`), the canonical resource a pod-native reader
 * (mind-issues, the SolidOS issue-pane) would dereference.
 */
export function projectTrackerToRegistry(repo: Repo, tracker: Tracker): { upserted: number } {
  const stateDoc = `${trackerContainerUrl(repo)}state.ttl`;
  const db = getDb();
  const now = Date.now();

  // INSERT … ON CONFLICT(repo_id, number): the tracker's number is authoritative
  // (it derives from the issue's ULID, not a registry counter), so we key on it
  // rather than allocating a fresh one. created_at is preserved on conflict.
  const upsert = db.prepare(
    `INSERT INTO issues
       (repo_id, number, title, body, status, priority,
        author_webid, labels, pod_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, number) DO UPDATE SET
       title        = excluded.title,
       body         = excluded.body,
       status       = excluded.status,
       labels       = excluded.labels,
       pod_url      = excluded.pod_url,
       updated_at   = excluded.updated_at`,
  );

  const tx = db.transaction((issues: Tracker["issues"]) => {
    let n = 0;
    for (const issue of issues) {
      if (issue.number == null) continue; // a registry row is keyed by number
      const label = (issue.categoryLabel ?? issue.categoryId ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      upsert.run(
        repo.id,
        issue.number,
        issue.title,
        issue.description ?? "",
        issue.open ? "open" : "closed",
        issue.assignee ?? "",
        // Only a well-formed single label; otherwise none (empty string).
        /^[a-z0-9][a-z0-9._-]{0,31}$/.test(label) ? label : "",
        `${stateDoc}#${issue.id}`,
        now,
        now,
      );
      n++;
    }
    return n;
  });

  return { upserted: tx(tracker.issues) };
}
