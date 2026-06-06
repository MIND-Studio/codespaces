/**
 * tracker-build core — fold the Markdown-authored, event-sourced `.mind/issues/`
 * tracker of an arbitrary repo working tree into canonical Turtle.
 *
 * Extracted from `scripts/tracker-build.ts` so it can run both as the CLI
 * (against this repo's own `.mind/`) and **server-side** against a checked-out
 * consumer repo (the "create issue" path). Unlike the script it NEVER calls
 * `process.exit` — every failure throws {@link TrackerBuildError} so an API
 * route can catch it and return a 4xx instead of killing the bridge.
 *
 * Pure `node:fs` — no shell, no globals. `buildTrackerOutputs(rootDir)` reads
 * `<rootDir>/.mind/issues/**` and returns the three `build/*.ttl` documents as
 * strings; the caller decides where to write them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export class TrackerBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerBuildError";
  }
}

function fail(msg: string): never {
  throw new TrackerBuildError(msg);
}

// On-disk address: <unix-seconds>_<rand4>. Same shape for epics and issues — the
// tree level disambiguates (epics sit in issues/; issues sit inside an epic or the
// general dir). Stable identity (RDF fragment, display number) comes from
// frontmatter, never the folder name, so an address never has to change.
const ENTRY_DIR_RE = /^\d{8,}_[a-z0-9]{4}$/;
const GENERAL_DIR = "00_general_issues"; // un-epic'd lane — issues, but no epic.md / no mc:epic
const EPIC_STATUSES = new Set(["planned", "active", "done", "parked"]);

const NS = {
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  flow: "http://www.w3.org/2005/01/wf/flow#",
  wf: "http://www.w3.org/2005/01/wf/flow#",
  dct: "http://purl.org/dc/terms/",
  dc: "http://purl.org/dc/elements/1.1/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  ui: "http://www.w3.org/ns/ui#",
  owl: "http://www.w3.org/2002/07/owl#",
  foaf: "http://xmlns.com/foaf/0.1/",
};

type State = { id: string; label: string; open: boolean; sortOrder?: number; color?: string };
type Category = { id: string; label: string; color?: string };
type Config = {
  title: string;
  description?: string;
  namespace: string;
  initialState: string;
  defaultView?: string;
  assigneeClass?: string;
  allowSubIssues?: boolean;
  states: State[];
  categories: Category[];
  properties: string[];
};
type Issue = {
  id: string;
  number?: number;
  title: string;
  category: string;
  state: string;
  created?: string;
  modified?: string;
  assignee?: string;
  afk?: boolean;
  blocks: string[];
  blockedBy: string[];
  body: string;
  dir: string;
};
type Epic = {
  slug: string;
  number: number;
  title: string;
  status: string;
  created?: string;
  body: string;
  issues: Issue[];
  isGeneral?: boolean;
};

export type TrackerBuildResult = {
  outputs: Record<string, string>;
  epicCount: number;
  issueCount: number;
  config: { states: number; categories: number };
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function frontmatter(text: string, file: string): { data: any; body: string } {
  if (!text.startsWith("---")) fail(`${file}: missing YAML frontmatter (must start with '---')`);
  const end = text.indexOf("\n---", 3);
  if (end === -1) fail(`${file}: unterminated YAML frontmatter (no closing '---')`);
  const yaml = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trimEnd();
  let data: any;
  try {
    data = parseYaml(yaml) ?? {};
  } catch (e) {
    fail(`${file}: invalid YAML frontmatter — ${(e as Error).message}`);
  }
  return { data, body };
}

function className(id: string): string {
  return String(id)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
  if (!m) fail(`date "${s}" is not YYYY-MM-DD (or an ISO datetime)`);
  return m[1];
}

/**
 * Derive the display handle number (MC-NNNN) from a canonical ULID — the
 * trailing decimal run (…OPEN0142 → 142). Returns undefined when the id ends in
 * no digits.
 */
export function handleNumber(id: string): number | undefined {
  const m = id.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : undefined;
}

function ttlLong(text: string): string {
  let s = text.replace(/\\/g, "\\\\");
  s = s.replace(/"""/g, '\\"\\"\\"');
  if (s.endsWith('"')) s = s.slice(0, -1) + '\\"';
  return `"""${s}"""`;
}

function ttlShort(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function prefixHeader(prefixes: (keyof typeof NS)[], base: string): string {
  return `@prefix : <${base}> .\n` + prefixes.map((p) => `@prefix ${p}: <${NS[p]}> .\n`).join("");
}

function issueFrag(id: string): string {
  return id;
}

// ── Load + validate ────────────────────────────────────────────────────────────
function loadConfig(issuesDir: string, rootDir: string): Config {
  const configFile = join(issuesDir, "tracker.config.md");
  if (!existsSync(configFile)) fail(`missing ${relative(rootDir, configFile)}`);
  const { data } = frontmatter(readFileSync(configFile, "utf8"), "tracker.config.md");
  for (const k of ["title", "namespace", "initialState", "states", "categories"]) {
    if (data[k] == null) fail(`tracker.config.md: missing required key "${k}"`);
  }
  const states: State[] = (data.states as any[]).map((s) => ({ ...s, label: s.label ?? s.id }));
  const categories: Category[] = (data.categories as any[]).map((c) => ({ ...c, label: c.label ?? c.id }));
  const cfg: Config = {
    title: data.title,
    description: data.description,
    namespace: data.namespace,
    initialState: data.initialState,
    defaultView: data.defaultView ?? "TableView",
    assigneeClass: data.assigneeClass ?? "foaf:Person",
    allowSubIssues: Boolean(data.allowSubIssues ?? false),
    states,
    categories,
    properties: data.properties ?? [],
  };
  if (!cfg.states.length) fail("tracker.config.md: at least one state required");
  if (!cfg.categories.length) fail("tracker.config.md: at least one category required");
  if (!cfg.states.some((s) => s.id === cfg.initialState))
    fail(`tracker.config.md: initialState "${cfg.initialState}" is not a declared state`);
  return cfg;
}

function foldEvents(
  cfg: Config,
  eventsDir: string,
  rel: string,
): { state: string; holder?: string; afk?: boolean; blocks: string[]; modified?: string } | null {
  if (!existsSync(eventsDir)) return null;
  const files = readdirSync(eventsDir).filter((f) => f.endsWith(".md")).sort();
  if (!files.length) return null;
  const stateIds = new Set(cfg.states.map((s) => s.id));

  let state = cfg.initialState;
  let holder: string | undefined;
  let blocks: string[] = [];
  let lastAt: unknown;
  for (const f of files) {
    const { data } = frontmatter(readFileSync(join(eventsDir, f), "utf8"), `${rel}/events/${f}`);
    if (data.at != null) lastAt = data.at;
    if (data.to != null) {
      if (!stateIds.has(data.to)) fail(`${rel}/events/${f}: \`to: ${data.to}\` is not a declared state`);
      state = data.to;
    }
    if (Array.isArray(data.blocks)) blocks = data.blocks.map(String);
    if (data.kind === "claim") holder = data.actor != null ? String(data.actor) : holder;
    else if (data.kind === "release") holder = undefined;
    else if (data.to != null && data.to !== "doing") holder = undefined;
  }
  return { state, holder, blocks, modified: lastAt != null ? ymd(lastAt) : undefined };
}

function loadIssuesIn(cfg: Config, groupDir: string, groupRel: string): Issue[] {
  const catIds = new Set(cfg.categories.map((c) => c.id));
  const issueDirs = readdirSync(groupDir)
    .filter((name) => ENTRY_DIR_RE.test(name) && statSync(join(groupDir, name)).isDirectory())
    .sort();
  const issues: Issue[] = [];
  for (const name of issueDirs) {
    const dir = join(groupDir, name);
    const rel = `${groupRel}/${name}`;
    const issueFile = join(dir, "issue.md");
    if (!existsSync(issueFile)) fail(`${rel}/: missing issue.md`);
    const { data, body } = frontmatter(readFileSync(issueFile, "utf8"), `${rel}/issue.md`);
    for (const k of ["id", "title", "type"]) {
      if (data[k] == null) fail(`${rel}/issue.md: missing required key "${k}"`);
    }
    if (data.state != null)
      fail(`${rel}/issue.md: must NOT carry a \`state:\` field — state is the fold of events/`);
    const category = String(data.type);
    if (!catIds.has(category)) fail(`${rel}/issue.md: type "${category}" not in tracker.config.md categories`);

    const folded = foldEvents(cfg, join(dir, "events"), rel);
    if (!folded) fail(`${rel}/: no events/ — an issue needs at least an \`open\` event to have a state`);

    issues.push({
      id: String(data.id),
      number: handleNumber(String(data.id)),
      title: String(data.title),
      category,
      state: folded.state,
      created: data.created != null ? ymd(data.created) : undefined,
      modified: folded.modified ?? (data.created != null ? ymd(data.created) : undefined),
      assignee: folded.holder,
      afk: data.afk != null ? Boolean(data.afk) : undefined,
      blocks: folded.blocks,
      blockedBy: [],
      body,
      dir: rel,
    });
  }
  return issues;
}

function loadEpics(cfg: Config, issuesDir: string, rootDir: string): Epic[] {
  if (!existsSync(issuesDir)) fail(`missing ${relative(rootDir, issuesDir)}/`);
  const epics: Epic[] = [];
  const slugs = new Set<string>();

  const generalDir = join(issuesDir, GENERAL_DIR);
  if (existsSync(generalDir) && statSync(generalDir).isDirectory()) {
    const issues = loadIssuesIn(cfg, generalDir, GENERAL_DIR);
    if (issues.length)
      epics.push({ slug: GENERAL_DIR, number: 0, title: "General", status: "active", body: "", issues, isGeneral: true });
  }

  // Epics sort by their on-disk address (timestamp-prefixed ⇒ creation order);
  // mc:number is that 1-based position. Identity (the RDF fragment) is the
  // epic.md `id`, so renaming the folder or retitling the epic never moves a link.
  const epicDirs = readdirSync(issuesDir)
    .filter((name) => ENTRY_DIR_RE.test(name) && statSync(join(issuesDir, name)).isDirectory())
    .sort();
  let number = 0;
  for (const name of epicDirs) {
    const dir = join(issuesDir, name);
    const epicFile = join(dir, "epic.md");
    if (!existsSync(epicFile)) fail(`${name}/: missing epic.md`);
    const { data, body } = frontmatter(readFileSync(epicFile, "utf8"), `${name}/epic.md`);
    if (data.title == null) fail(`${name}/epic.md: missing required key "title"`);
    if (data.id == null) fail(`${name}/epic.md: missing required key "id"`);
    const status = String(data.status ?? "planned");
    if (!EPIC_STATUSES.has(status))
      fail(`${name}/epic.md: status "${status}" not in {${[...EPIC_STATUSES].join(", ")}}`);
    const slug = String(data.id);
    if (slugs.has(slug)) fail(`duplicate epic id "${slug}" (${name}/epic.md)`);
    slugs.add(slug);
    epics.push({
      slug,
      number: ++number,
      title: String(data.title),
      status,
      created: data.created != null ? ymd(data.created) : undefined,
      body,
      issues: loadIssuesIn(cfg, dir, name),
    });
  }
  return epics;
}

function linkDependencies(epics: Epic[]): void {
  const all = epics.flatMap((e) => e.issues);
  const byId = new Map(all.map((i) => [i.id, i]));
  for (const i of all) {
    i.blocks = i.blocks.filter((ref) => byId.has(ref));
    for (const ref of i.blocks) byId.get(ref)!.blockedBy.push(i.id);
  }
}

// ── Render ──────────────────────────────────────────────────────────────────────
function renderTracker(cfg: Config): string {
  let out = prefixHeader(["rdfs", "flow", "dct", "xsd", "ui", "owl", "foaf"], "#");
  out += `@prefix mc: <${cfg.namespace}> .\n\n`;
  out += `# Generated by scripts/tracker-build.ts from .mind/issues/tracker.config.md — do not edit by hand.\n`;
  out += `# Conforms to the Solid IssueTrackerShape (https://github.com/solid/shapes).\n\n`;

  out += `#### Issue states (subClassOf flow:Open / flow:Closed) ####\n`;
  for (const s of cfg.states) {
    const c = className(s.id);
    const parent = s.open ? "flow:Open" : "flow:Closed";
    out += `:${c} a rdfs:Class ;\n`;
    out += `    rdfs:label ${ttlShort(s.label)} ;\n`;
    out += `    rdfs:subClassOf ${parent} , :Issue ;\n`;
    if (s.sortOrder != null) out += `    ui:sortOrder ${s.sortOrder} ;\n`;
    if (s.color) out += `    ui:backgroundColor ${ttlShort(s.color)} ;\n`;
    out = out.replace(/ ;\n$/, " .\n") + "\n";
  }

  out += `#### Issue class (flow:issueClass) ####\n`;
  out += `:Issue a rdfs:Class ;\n`;
  out += `    rdfs:label "Issue" ;\n`;
  out += `    rdfs:subClassOf flow:Task ;\n`;
  out += `    owl:disjointUnionOf ( ${cfg.states.map((s) => ":" + className(s.id)).join(" ")} ) .\n\n`;

  out += `#### Issue categories (flow:issueCategory) ####\n`;
  for (const c of cfg.categories) {
    out += `:${className(c.id)} a rdfs:Class ;\n`;
    out += `    rdfs:label ${ttlShort(c.label)} ;\n`;
    out += `    rdfs:subClassOf :Category ;\n`;
    if (c.color) out += `    ui:backgroundColor ${ttlShort(c.color)} ;\n`;
    out = out.replace(/ ;\n$/, " .\n") + "\n";
  }
  out += `:Category a rdfs:Class ;\n`;
  out += `    rdfs:label "category" ;\n`;
  out += `    owl:disjointUnionOf ( ${cfg.categories.map((c) => ":" + className(c.id)).join(" ")} ) .\n\n`;

  out += `#### The tracker ####\n`;
  out += `:this a flow:Tracker ;\n`;
  out += `    dct:title ${ttlShort(cfg.title)} ;\n`;
  out += `    rdfs:label ${ttlShort(cfg.title)} ;\n`;
  if (cfg.description) out += `    flow:description ${ttlShort(cfg.description)} ;\n`;
  out += `    flow:issueClass :Issue ;\n`;
  out += `    flow:issueCategory :Category ;\n`;
  out += `    flow:initialState :${className(cfg.initialState)} ;\n`;
  out += `    flow:defaultView flow:${cfg.defaultView} ;\n`;
  out += `    flow:assigneeClass ${cfg.assigneeClass} ;\n`;
  out += `    flow:allowSubIssues ${cfg.allowSubIssues ? "true" : "false"} ;\n`;
  if (cfg.properties.length)
    out += `    flow:propertyList ( ${cfg.properties.map((p) => "mc:" + p).join(" ")} ) ;\n`;
  out += `    flow:stateStore <state.ttl> .\n`;
  return out;
}

function renderEpics(cfg: Config, epics: Epic[]): string {
  let out = prefixHeader(["rdfs", "dct", "xsd"], "#");
  out += `@prefix mc: <${cfg.namespace}> .\n\n`;
  out += `# Generated by scripts/tracker-build.ts from .mind/issues/*/epic.md — do not edit by hand.\n`;
  out += `# Each mc:Epic is a goal grouping a collection of issues (see state.ttl mc:epic links).\n\n`;
  for (const e of epics) {
    if (e.isGeneral) continue;
    const lines: string[] = [];
    lines.push(`a mc:Epic`);
    lines.push(`mc:number ${e.number}`);
    lines.push(`dct:title ${ttlShort(e.title)}`);
    lines.push(`rdfs:label ${ttlShort(e.title)}`);
    lines.push(`mc:status ${ttlShort(e.status)}`);
    lines.push(`mc:issueCount ${e.issues.length}`);
    if (e.created) lines.push(`dct:created "${e.created}"^^xsd:date`);
    lines.push(`dct:description ${ttlLong(e.body)}`);
    out += `<#${e.slug}>\n    ` + lines.join(" ;\n    ") + " .\n\n";
  }
  return out;
}

function renderState(cfg: Config, epics: Epic[]): string {
  let out = prefixHeader(["wf", "dct", "dc", "rdfs", "xsd", "foaf"], "tracker.ttl#");
  out += `@prefix mc: <${cfg.namespace}> .\n\n`;
  out += `# Generated by scripts/tracker-build.ts from .mind/issues/ (folded events/) — do not edit by hand.\n`;
  out += `# The tracker's flow:stateStore. An issue's state & category are its rdf:type;\n`;
  out += `# mc:epic links each issue to its epic in epics.ttl.\n\n`;

  for (const e of epics) {
    out += `#### ${e.isGeneral ? "General (un-epic'd)" : `Epic: ${e.slug}`} ####\n`;
    for (const i of e.issues) {
      const lines: string[] = [];
      lines.push(`wf:tracker :this`);
      if (i.number != null) lines.push(`mc:number ${i.number}`);
      if (!e.isGeneral) lines.push(`mc:epic <epics.ttl#${e.slug}>`);
      lines.push(`dc:title ${ttlShort(i.title)}`);
      lines.push(`a :${className(i.state)} , :${className(i.category)}`);
      if (i.created) lines.push(`dct:created "${i.created}"^^xsd:date`);
      if (i.modified) lines.push(`dct:modified "${i.modified}"^^xsd:date`);
      if (i.assignee) lines.push(`wf:assignee <${i.assignee}>`);
      if (i.afk != null) lines.push(`mc:afk ${i.afk ? "true" : "false"}`);
      if (i.blocks.length) lines.push(`mc:blocks ${i.blocks.map((b) => `<#${issueFrag(b)}>`).join(" , ")}`);
      if (i.blockedBy.length)
        lines.push(`mc:blockedBy ${i.blockedBy.map((b) => `<#${issueFrag(b)}>`).join(" , ")}`);
      lines.push(`wf:description ${ttlLong(i.body)}`);
      out += `<#${issueFrag(i.id)}>\n    ` + lines.join(" ;\n    ") + " .\n\n";
    }
  }
  return out;
}

/**
 * Fold `<rootDir>/.mind/issues/**` into the canonical `{tracker,epics,state}.ttl`
 * trio (returned as strings). Throws {@link TrackerBuildError} on any malformed
 * input. The caller writes the outputs to `<rootDir>/.mind/build/`.
 */
export function buildTrackerOutputs(rootDir: string): TrackerBuildResult {
  const issuesDir = join(rootDir, ".mind", "issues");
  const cfg = loadConfig(issuesDir, rootDir);
  const epics = loadEpics(cfg, issuesDir, rootDir);
  linkDependencies(epics);
  const issueCount = epics.reduce((n, e) => n + e.issues.length, 0);
  const epicCount = epics.filter((e) => !e.isGeneral).length;
  return {
    outputs: {
      "tracker.ttl": renderTracker(cfg),
      "epics.ttl": renderEpics(cfg, epics),
      "state.ttl": renderState(cfg, epics),
    },
    epicCount,
    issueCount,
    config: { states: cfg.states.length, categories: cfg.categories.length },
  };
}
