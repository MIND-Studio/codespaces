/**
 * RDF-free types for a `.mind`-derived `flow:Tracker`, as read from a repo's
 * committed `.mind/build/{tracker,epics,state}.ttl` trio.
 *
 * An issue's **state** and **category** are its `rdf:type` (the SolidOS
 * convention): states are `rdfs:subClassOf flow:Open`/`flow:Closed`, categories
 * are `rdfs:subClassOf :Category`. We key both by their full class IRI and keep
 * the local name as a convenient `id`. These types intentionally mirror
 * `mind-issues-v0/src/lib/solid/model.ts` so the two readers can converge later.
 */

export type IssueState = {
  /** Local class name, e.g. "InProgress" — a stable handle. */
  id: string;
  /** Full class IRI (the identity used to join issues → states). */
  classIri: string;
  /** Human label, e.g. "in progress". */
  label: string;
  /** True if `subClassOf flow:Open` (an open state). */
  open: boolean;
};

export type IssueCategory = {
  id: string;
  classIri: string;
  label: string;
};

export type TrackerEpic = {
  /** Local name, e.g. "pod-owned-collaboration". */
  slug: string;
  /** Full IRI of the epic resource. */
  iri: string;
  number?: number;
  title: string;
  status?: string;
  /** mc:issueCount as declared in epics.ttl (may differ from rendered count). */
  issueCount?: number;
  /** dct:description (Markdown brief). */
  description?: string;
  /** dct:created ISO date. */
  created?: string;
};

export type TrackerIssue = {
  /** Canonical ULID local name from `<#ULID>`. */
  id: string;
  /** Full IRI including the `#…` fragment. */
  iri: string;
  number?: number;
  title: string;
  /** Local name of the current state class (∈ tracker.states). */
  stateId?: string;
  stateLabel?: string;
  /** Resolved open/closed flag from the state; defaults open when unknown. */
  open: boolean;
  categoryId?: string;
  categoryLabel?: string;
  /** Local name of the `mc:epic` target — undefined ⇒ General (un-epic'd). */
  epicSlug?: string;
  created?: string;
  modified?: string;
  /** wf:assignee WebID. */
  assignee?: string;
  /** mc:afk — agent-runnable flag. */
  afk?: boolean;
  /** mc:blocks — local names of issues this one blocks. */
  blocks: string[];
  /** mc:blockedBy — local names of issues blocking this one. */
  blockedBy: string[];
  /** wf:description — the Markdown body. */
  description?: string;
};

export type Tracker = {
  title: string;
  description?: string;
  states: IssueState[];
  categories: IssueCategory[];
  /** Sorted by mc:number. */
  epics: TrackerEpic[];
  /** Sorted by mc:number. */
  issues: TrackerIssue[];
};

export type TrackerGroup =
  | { kind: "epic"; epic: TrackerEpic; issues: TrackerIssue[] }
  | { kind: "general"; issues: TrackerIssue[] };

/** The fragment/local name of an IRI (after the last `#` or `/`). */
export function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.replace(/\/$/, "").lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

/**
 * Bucket issues into the "general" (un-epic'd) group first, then each epic in
 * `tracker.epics` order (by mc:number).
 *
 * `issues` is the (status-)filtered set; `tracker.issues` is the full set. An
 * epic shows when it has issues in the filtered set **or** it has no issues at
 * all in the whole tracker — so a freshly created, still-empty epic is visible
 * on the board, while an epic whose issues are merely filtered out (e.g. all
 * closed while viewing "open") stays hidden rather than cluttering the view.
 */
export function groupByEpic(
  tracker: Tracker,
  issues: TrackerIssue[],
): TrackerGroup[] {
  const groups: TrackerGroup[] = [];
  const general = issues.filter(
    (i) => !i.epicSlug || !tracker.epics.some((e) => e.slug === i.epicSlug),
  );
  if (general.length > 0) groups.push({ kind: "general", issues: general });
  for (const epic of tracker.epics) {
    const inEpic = issues.filter((i) => i.epicSlug === epic.slug);
    const totalInEpic = tracker.issues.filter(
      (i) => i.epicSlug === epic.slug,
    ).length;
    if (inEpic.length > 0 || totalInEpic === 0) {
      groups.push({ kind: "epic", epic, issues: inEpic });
    }
  }
  return groups;
}
