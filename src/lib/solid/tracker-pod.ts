import "server-only";
import type { Repo } from "@/lib/registry/repos";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import { readBlob, hasAnyCommits } from "@/lib/git/objects";
import { parseTrackerTrio } from "@/lib/tracker/parse";
import type { Tracker } from "@/lib/tracker/model";
import { log } from "@/lib/log";

/**
 * Mirror a repo's `.mind`-derived `flow:Tracker` into the **owner's pod**, so
 * the collaboration record (Issues + Epics) is canonical pod Turtle rather than
 * a working-tree artifact. This is the pod side of MC-160: `.mind/` stays the
 * authoring layer (markdown folders + append-only `events/`), `tracker-build`
 * folds it into the trio, and that trio lives in the pod next to `issues/` and
 * `inbox/`. The Registry/SQLite index becomes a rebuildable projection of this
 * pod truth (see `@/lib/registry/issue-projection`).
 *
 *   {podRoot}/codespaces/{repo}/.mind/                 (the tracker container)
 *   {podRoot}/codespaces/{repo}/.mind/tracker.ttl      (flow:Tracker shape)
 *   {podRoot}/codespaces/{repo}/.mind/epics.ttl        (mc:Epic groupings)
 *   {podRoot}/codespaces/{repo}/.mind/state.ttl        (flow:stateStore — issues)
 *
 * Multi-doc, append-only: the three documents mirror what the fold emits, which
 * is the safe model for the bridge's concurrent human+agent writers (each push
 * re-publishes the folded snapshot; the authoring history stays in `events/`).
 * The container is public-read (same ACL shape as `issues/`), so `mind-issues`
 * and the SolidOS issue-pane can render the same `flow:Tracker` by URL.
 */

/** The three folded Turtle documents that constitute the pod tracker. */
export type TrackerOutputs = {
  tracker: string;
  epics: string;
  state: string;
};

const DOC_NAMES = {
  tracker: "tracker.ttl",
  epics: "epics.ttl",
  state: "state.ttl",
} as const;

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** `{podRoot}/codespaces/{repo}/.mind/` — the tracker container in the pod. */
export function trackerContainerUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/.mind/`;
}

/**
 * Publish the folded `flow:Tracker` trio into the owner's pod, idempotently:
 * ensure the container exists, set a public-read ACL, then PUT each document.
 * Bridge-mediated with the owner's delegated fetch (parallels how Issues/PRs
 * and the inbox are written). Throws if the owner has no live connection — the
 * caller decides whether that's fatal (it isn't, for the fire-and-forget mirror
 * on push).
 */
export async function publishTrackerToPod(
  repo: Repo,
  outputs: TrackerOutputs,
): Promise<{ container: string; documents: string[] }> {
  const container = trackerContainerUrl(repo);
  const owner = await getOwnerFetch(repo.ownerWebId);

  await ensureContainer(owner.fetch, container);
  await setPublicReadAcl(owner.fetch, container, repo.ownerWebId);

  const written: string[] = [];
  for (const key of ["tracker", "epics", "state"] as const) {
    const url = `${container}${DOC_NAMES[key]}`;
    const res = await owner.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: outputs[key],
    });
    if (!res.ok && res.status !== 201 && res.status !== 205) {
      throw new Error(
        `failed to PUT tracker doc ${url}: ${res.status} ${res.statusText}`,
      );
    }
    written.push(url);
  }
  return { container, documents: written };
}

/**
 * Read the folded trio back from the pod. Returns `null` when there is no
 * `state.ttl` (the repo has no pod tracker yet) so callers can fall back to the
 * git-blob copy. `state.ttl` is the source of truth for "is there a tracker";
 * a missing `tracker.ttl`/`epics.ttl` degrades gracefully (parser tolerates
 * nulls).
 */
export async function readPodTrackerOutputs(
  repo: Repo,
): Promise<TrackerOutputs | null> {
  const container = trackerContainerUrl(repo);
  const owner = await getOwnerFetch(repo.ownerWebId);

  const get = async (name: string): Promise<string | null> => {
    const res = await owner.fetch(`${container}${name}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `failed to GET tracker doc ${container}${name}: ${res.status}`,
      );
    }
    return res.text();
  };

  const state = await get(DOC_NAMES.state);
  if (state === null) return null;
  const [tracker, epics] = await Promise.all([
    get(DOC_NAMES.tracker),
    get(DOC_NAMES.epics),
  ]);
  return { tracker: tracker ?? "", epics: epics ?? "", state };
}

/**
 * Read the repo's `flow:Tracker` from the **pod** and parse it into the render
 * model — the MC-160 acceptance that the dashboard reads the pod copy, not the
 * working tree. Returns `null` when there's no pod tracker (caller falls back to
 * `readGitTracker`).
 */
export async function readPodTracker(
  repo: Repo,
  owner: string,
  name: string,
): Promise<Tracker | null> {
  const outputs = await readPodTrackerOutputs(repo);
  if (!outputs) return null;
  return parseTrackerTrio(
    { tracker: outputs.tracker, epics: outputs.epics, state: outputs.state },
    owner,
    name,
  );
}

/**
 * Mirror the trio from the bare repo's committed `.mind/build/` (at `ref`) into
 * the pod. Used by the post-receive hook: every push that lands a `.mind/build`
 * update re-publishes the snapshot. Fail-soft — returns `false` (and logs) on
 * any error so a pod hiccup never blocks the git push or the rest of the
 * post-receive chain. Returns `false` when the pushed ref has no `state.ttl`
 * (nothing to mirror).
 */
export async function mirrorTrackerFromGit(
  repo: Repo,
  bareRepoPath: string,
  ref: string,
): Promise<boolean> {
  try {
    if (!(await hasAnyCommits(bareRepoPath))) return false;
    const read = async (file: string): Promise<string | null> => {
      const blob = await readBlob(bareRepoPath, ref, `.mind/build/${file}`);
      return blob ? blob.bytes.toString("utf-8") : null;
    };
    const state = await read(DOC_NAMES.state);
    if (state === null) return false; // no tracker in this push
    const [tracker, epics] = await Promise.all([
      read(DOC_NAMES.tracker),
      read(DOC_NAMES.epics),
    ]);
    await publishTrackerToPod(repo, {
      tracker: tracker ?? "",
      epics: epics ?? "",
      state,
    });
    log.info("tracker.pod.mirrored", {
      repo: `${repo.owner}/${repo.name}`,
      container: trackerContainerUrl(repo),
    });
    return true;
  } catch (e) {
    log.warn("tracker.pod.mirror_failed", {
      repo: `${repo.owner}/${repo.name}`,
      error: (e as Error).message ?? String(e),
    });
    return false;
  }
}
