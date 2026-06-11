import { Parser, type Quad, type Term } from "n3";
import {
  localName,
  type IssueCategory,
  type IssueState,
  type Tracker,
  type TrackerEpic,
  type TrackerIssue,
} from "./model";

// --- Vocabulary ------------------------------------------------------------
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const FLOW = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const DC = "http://purl.org/dc/elements/1.1/";
// Fallback only — the real mc: namespace is per-tracker (tracker.config.md
// `namespace:`) and is sniffed from the parsed quads, see detectMcNamespace.
const MC_FALLBACK = "https://mindpods.org/ns/codespaces-tracker#";

const RDF_TYPE = RDF + "type";
const RDFS_SUBCLASSOF = RDFS + "subClassOf";
const RDFS_LABEL = RDFS + "label";
const FLOW_TRACKER = FLOW + "Tracker";
const FLOW_OPEN = FLOW + "Open";
const FLOW_CLOSED = FLOW + "Closed";
const FLOW_ISSUE_CLASS = FLOW + "issueClass";
const FLOW_ISSUE_CATEGORY = FLOW + "issueCategory";
const FLOW_DESCRIPTION = FLOW + "description";
const WF_TRACKER = FLOW + "tracker";
const WF_ASSIGNEE = FLOW + "assignee";
const DCT_TITLE = DCT + "title";
const DCT_CREATED = DCT + "created";
const DCT_MODIFIED = DCT + "modified";
const DCT_DESCRIPTION = DCT + "description";
const DC_TITLE = DC + "title";

/** Per-tracker mc:* term IRIs, resolved against the detected namespace. */
type McVocab = {
  epicClass: string;
  number: string;
  epic: string;
  afk: string;
  blocks: string;
  blockedBy: string;
  status: string;
  issueCount: string;
};

function mcVocab(ns: string): McVocab {
  return {
    epicClass: ns + "Epic",
    number: ns + "number",
    epic: ns + "epic",
    afk: ns + "afk",
    blocks: ns + "blocks",
    blockedBy: ns + "blockedBy",
    status: ns + "status",
    issueCount: ns + "issueCount",
  };
}

const MC_LOCAL_NAMES = new Set([
  "number",
  "epic",
  "afk",
  "blocks",
  "blockedBy",
  "status",
  "issueCount",
]);

/**
 * The generator emits mc:* terms in the tracker's own namespace (frontmatter
 * `namespace:`), so a fixed constant only ever matched the codespaces repo
 * itself — every other tracker lost number/epic/afk/blocks on parse. Sniff
 * the namespace from the predicates instead.
 */
function detectMcNamespace(idx: Index): string {
  for (const p of idx.predicates()) {
    const hash = p.lastIndexOf("#");
    if (hash < 0) continue;
    const ns = p.slice(0, hash + 1);
    if (ns === RDF || ns === RDFS || ns === FLOW) continue;
    if (MC_LOCAL_NAMES.has(p.slice(hash + 1))) return ns;
  }
  return MC_FALLBACK;
}

/**
 * A flat quad index keyed by subject IRI → predicate IRI → object terms, with
 * small typed accessors. Quads from all three trio docs are merged into one
 * index: because each doc is parsed against its own base IRI the subjects land
 * in distinct namespaces (`…/tracker.ttl#`, `…/epics.ttl#`, `…/state.ttl#`), so
 * cross-doc references (`a :Done`, `mc:epic <epics.ttl#slug>`) join by exact
 * IRI string and there are no collisions.
 */
class Index {
  private bysubj = new Map<string, Map<string, Term[]>>();
  private predIris = new Set<string>();

  add(quads: Quad[]): void {
    for (const q of quads) {
      const s = q.subject.value;
      let preds = this.bysubj.get(s);
      if (!preds) {
        preds = new Map();
        this.bysubj.set(s, preds);
      }
      this.predIris.add(q.predicate.value);
      const objs = preds.get(q.predicate.value);
      if (objs) objs.push(q.object);
      else preds.set(q.predicate.value, [q.object]);
    }
  }

  subjects(): string[] {
    return [...this.bysubj.keys()];
  }

  predicates(): string[] {
    return [...this.predIris];
  }

  private objs(subj: string, pred: string): Term[] {
    return this.bysubj.get(subj)?.get(pred) ?? [];
  }

  /** Object IRI/literal values, in document order. */
  iris(subj: string, pred: string): string[] {
    return this.objs(subj, pred).map((t) => t.value);
  }

  iri(subj: string, pred: string): string | undefined {
    return this.objs(subj, pred)[0]?.value;
  }

  /** First object's lexical value (literal text or IRI). */
  str(subj: string, pred: string): string | undefined {
    return this.objs(subj, pred)[0]?.value;
  }

  /** First of several predicates that yields a value (e.g. dc:title → dct:title). */
  strAny(subj: string, ...preds: string[]): string | undefined {
    for (const p of preds) {
      const v = this.str(subj, p);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  int(subj: string, pred: string): number | undefined {
    const v = this.str(subj, pred);
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }

  bool(subj: string, pred: string): boolean | undefined {
    const v = this.str(subj, pred);
    if (v === undefined) return undefined;
    return v === "true" || v === "1";
  }

  hasType(subj: string, typeIri: string): boolean {
    return this.iris(subj, RDF_TYPE).includes(typeIri);
  }
}

function parseDoc(ttl: string, baseIRI: string): Quad[] {
  return new Parser({ baseIRI }).parse(ttl);
}

/**
 * Pure parse step: turn the three Turtle docs (state required, tracker/epics
 * optional) into a {@link Tracker}. Split out from the git read so it can be
 * unit-tested against fixture strings. Returns `null` if `state` is empty.
 */
export function parseTrackerTrio(
  ttl: { tracker: string | null; epics: string | null; state: string | null },
  owner: string,
  name: string,
): Tracker | null {
  if (!ttl.state) return null;

  // Synthetic, consistent per-doc bases so relative IRIs across the trio resolve
  // into one joinable namespace (see Index doc comment).
  const baseRoot = `mind://${owner}/${name}/.mind/build/`;
  const idx = new Index();
  if (ttl.tracker) idx.add(parseDoc(ttl.tracker, baseRoot + "tracker.ttl"));
  if (ttl.epics) idx.add(parseDoc(ttl.epics, baseRoot + "epics.ttl"));
  idx.add(parseDoc(ttl.state, baseRoot + "state.ttl"));

  const trackerIri = idx.subjects().find((s) => idx.hasType(s, FLOW_TRACKER));
  const issueClassIri = trackerIri
    ? idx.iri(trackerIri, FLOW_ISSUE_CLASS)
    : undefined;
  const categoryClassIri = trackerIri
    ? idx.iri(trackerIri, FLOW_ISSUE_CATEGORY)
    : undefined;

  const states = parseStates(idx, issueClassIri);
  const categories = parseCategories(idx, categoryClassIri);
  const stateIris = new Set(states.map((s) => s.classIri));
  const catIris = new Set(categories.map((c) => c.classIri));
  const stateById = new Map(states.map((s) => [s.classIri, s]));
  const catById = new Map(categories.map((c) => [c.classIri, c]));

  const mc = mcVocab(detectMcNamespace(idx));
  const epics = parseEpics(idx, mc);
  const issues = parseIssues(idx, mc, stateIris, catIris, stateById, catById);

  return {
    title: (trackerIri && idx.strAny(trackerIri, DCT_TITLE, RDFS_LABEL)) || `${owner}/${name}`,
    description: trackerIri ? idx.str(trackerIri, FLOW_DESCRIPTION) : undefined,
    states,
    categories,
    epics,
    issues,
  };
}

function parseStates(idx: Index, issueClassIri?: string): IssueState[] {
  return idx
    .subjects()
    .filter((s) => {
      if (s === issueClassIri) return false;
      const supers = idx.iris(s, RDFS_SUBCLASSOF);
      return issueClassIri
        ? supers.includes(issueClassIri)
        : supers.includes(FLOW_OPEN) || supers.includes(FLOW_CLOSED);
    })
    .map((s): IssueState => {
      const supers = idx.iris(s, RDFS_SUBCLASSOF);
      return {
        id: localName(s),
        classIri: s,
        label: idx.str(s, RDFS_LABEL) ?? localName(s),
        open: supers.includes(FLOW_OPEN) || !supers.includes(FLOW_CLOSED),
      };
    });
}

function parseCategories(idx: Index, categoryClassIri?: string): IssueCategory[] {
  if (!categoryClassIri) return [];
  return idx
    .subjects()
    .filter(
      (s) =>
        s !== categoryClassIri &&
        idx.iris(s, RDFS_SUBCLASSOF).includes(categoryClassIri),
    )
    .map((s): IssueCategory => ({
      id: localName(s),
      classIri: s,
      label: idx.str(s, RDFS_LABEL) ?? localName(s),
    }));
}

function parseEpics(idx: Index, mc: McVocab): TrackerEpic[] {
  return idx
    .subjects()
    .filter((s) => idx.hasType(s, mc.epicClass))
    .map((s): TrackerEpic => ({
      slug: localName(s),
      iri: s,
      number: idx.int(s, mc.number),
      title: idx.strAny(s, DCT_TITLE, RDFS_LABEL) ?? localName(s),
      status: idx.str(s, mc.status),
      issueCount: idx.int(s, mc.issueCount),
      description: idx.str(s, DCT_DESCRIPTION),
      created: idx.str(s, DCT_CREATED),
    }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

function parseIssues(
  idx: Index,
  mc: McVocab,
  stateIris: Set<string>,
  catIris: Set<string>,
  stateById: Map<string, IssueState>,
  catById: Map<string, IssueCategory>,
): TrackerIssue[] {
  // Primary filter: subjects linked to the tracker via wf:tracker. Fall back to
  // "has a known state type" for trackers that omit the back-link.
  let subjects = idx.subjects().filter((s) => idx.iri(s, WF_TRACKER));
  if (subjects.length === 0) {
    subjects = idx
      .subjects()
      .filter((s) => idx.iris(s, RDF_TYPE).some((t) => stateIris.has(t)));
  }
  return subjects
    .map((s): TrackerIssue => {
      const types = idx.iris(s, RDF_TYPE);
      const stateIri = types.find((t) => stateIris.has(t));
      const catIri = types.find((t) => catIris.has(t));
      const state = stateIri ? stateById.get(stateIri) : undefined;
      const category = catIri ? catById.get(catIri) : undefined;
      const epicIri = idx.iri(s, mc.epic);
      return {
        id: localName(s),
        iri: s,
        number: idx.int(s, mc.number),
        title: idx.strAny(s, DC_TITLE, DCT_TITLE) ?? localName(s),
        stateId: state?.id,
        stateLabel: state?.label,
        open: state ? state.open : true,
        categoryId: category?.id,
        categoryLabel: category?.label,
        epicSlug: epicIri ? localName(epicIri) : undefined,
        created: idx.str(s, DCT_CREATED),
        modified: idx.str(s, DCT_MODIFIED),
        assignee: idx.iri(s, WF_ASSIGNEE),
        afk: idx.bool(s, mc.afk),
        blocks: idx.iris(s, mc.blocks).map(localName),
        blockedBy: idx.iris(s, mc.blockedBy).map(localName),
        description: idx.str(s, FLOW_DESCRIPTION),
      };
    })
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}
