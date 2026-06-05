import "server-only";
import { hasAnyCommits, readBlob } from "@/lib/git/objects";
import { parseTrackerTrio } from "./parse";
import { groupByEpic, localName, type Tracker } from "./model";

export { groupByEpic, localName, parseTrackerTrio };
export type {
  Tracker,
  TrackerEpic,
  TrackerIssue,
  TrackerGroup,
  IssueState,
  IssueCategory,
} from "./model";

const BUILD_DIR = ".mind/build";

async function readUtf8(
  bare: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const blob = await readBlob(bare, ref, path);
  return blob ? blob.bytes.toString("utf-8") : null;
}

/**
 * Read a repo's `.mind`-derived `flow:Tracker` from its committed
 * `.mind/build/{tracker,epics,state}.ttl` trio at `ref` (default HEAD).
 *
 * Returns `null` when the repo has no commits or no `state.ttl` — callers treat
 * that as "this repo has no tracker" and fall back to an empty state.
 */
export async function readGitTracker(
  bare: string,
  owner: string,
  name: string,
  ref = "HEAD",
): Promise<Tracker | null> {
  if (!(await hasAnyCommits(bare))) return null;

  const state = await readUtf8(bare, ref, `${BUILD_DIR}/state.ttl`);
  if (state === null) return null; // no tracker in this repo

  const tracker = await readUtf8(bare, ref, `${BUILD_DIR}/tracker.ttl`);
  const epics = await readUtf8(bare, ref, `${BUILD_DIR}/epics.ttl`);

  return parseTrackerTrio({ tracker, epics, state }, owner, name);
}
