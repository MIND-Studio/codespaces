import "server-only";
import type { Repo } from "@/lib/registry/repos";
import { repoPath } from "@/lib/git/backend";
import { readGitTracker } from "./read";
import { readPodTracker } from "@/lib/solid/tracker-pod";
import type { Tracker } from "./model";
import { log } from "@/lib/log";

/**
 * Read a repo's `flow:Tracker` for rendering — the single seam the dashboard
 * uses (the Issues board and the repo-tabs count). MC-160: the **pod** copy is
 * canonical, so try it first; the committed `.mind/build/*.ttl` git blob is the
 * fallback.
 *
 * The pod read is best-effort: any failure (owner not connected, pod
 * unreachable, a malformed doc) falls back to the git blob so the board never
 * breaks. This keeps the migration safe — a repo whose `.mind` hasn't been
 * mirrored to the pod yet still renders from git, and a pod outage degrades to
 * the last-pushed snapshot rather than an error page.
 */
export async function readRepoTracker(
  repo: Repo,
  owner: string,
  name: string,
): Promise<Tracker | null> {
  try {
    const pod = await readPodTracker(repo, owner, name);
    if (pod) return pod;
  } catch (e) {
    log.warn("tracker.pod.read_failed", {
      repo: `${owner}/${name}`,
      error: (e as Error).message ?? String(e),
    });
  }
  return readGitTracker(repoPath(repo.owner, repo.name), owner, name);
}
