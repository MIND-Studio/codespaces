#!/usr/bin/env tsx
/**
 * calendar-build — render the Markdown-authored `.mind/calendar/` into canonical,
 * Solid-conformant iCalendar Turtle. Sibling of scripts/tracker-build.ts.
 *
 * Source of truth is Markdown:
 *   .mind/calendar/calendar.config.md   — YAML frontmatter: title, eventTypes, statuses
 *   .mind/calendar/YYYY-MM-DD-<slug>.md — one event: frontmatter (→ RDF) + Markdown body
 *
 * Output (canonical, committed):
 *   .mind/calendar/build/calendar.ttl   — an ical:Vcalendar (http://www.w3.org/2002/12/cal/ical#)
 *                                         whose ical:components are ical:Vevent resources.
 *                                         Each event's type is part of its rdf:type
 *                                         (a ical:Vevent , :Release), mirroring the issue
 *                                         tracker's state/category-as-rdf:type convention.
 *
 * Usage:
 *   npm run calendar:build          # write build/calendar.ttl
 *   npm run calendar:check          # regenerate in memory, diff vs committed; exit 1 on drift
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(join(__dirname, ".."));
const CAL_DIR = join(REPO_ROOT, ".mind", "calendar");
const BUILD_DIR = join(CAL_DIR, "build");
const CONFIG_FILE = join(CAL_DIR, "calendar.config.md");

const CHECK = process.argv.includes("--check");
// Files in .mind/calendar/ that are NOT events.
const NON_EVENT = new Set(["calendar.config.md", "README.md"]);

// ── Namespaces ──────────────────────────────────────────────────────────────
const NS = {
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  ical: "http://www.w3.org/2002/12/cal/ical#",
  sched: "http://www.w3.org/ns/pim/schedule#",
  dct: "http://purl.org/dc/terms/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  ui: "http://www.w3.org/ns/ui#",
  owl: "http://www.w3.org/2002/07/owl#",
};

// ── Types ───────────────────────────────────────────────────────────────────
type EventType = { id: string; label: string; color?: string };
type Status = { id: string; label: string };
type Config = {
  title: string;
  description?: string;
  namespace: string;
  eventTypes: EventType[];
  statuses: Status[];
};
type CalEvent = {
  id: string;
  title: string;
  type: string;
  date: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  status?: string;
  location?: string;
  attendees: string[];
  links: string[];
  tags: string[];
  body: string;
  file: string;
  /** sort key: date + (time ?? "00:00") */
  sortKey: string;
};

// ── Helpers (mirrors scripts/tracker-build.ts) ────────────────────────────────
function die(msg: string): never {
  console.error(`calendar-build: ${msg}`);
  process.exit(1);
}

function frontmatter(text: string, file: string): { data: any; body: string } {
  if (!text.startsWith("---")) die(`${file}: missing YAML frontmatter (must start with '---')`);
  const end = text.indexOf("\n---", 3);
  if (end === -1) die(`${file}: unterminated YAML frontmatter (no closing '---')`);
  const yaml = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trimEnd();
  let data: any;
  try {
    data = parseYaml(yaml) ?? {};
  } catch (e) {
    die(`${file}: invalid YAML frontmatter — ${(e as Error).message}`);
  }
  return { data, body };
}

/** "release" → "Release" (a Turtle local name / class). */
function className(id: string): string {
  return String(id)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** Format a YAML-parsed date (Date or string) as an xsd:date lexical YYYY-MM-DD. */
function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) die(`date "${s}" is not YYYY-MM-DD`);
  return s;
}

/** Validate an HH:MM time string. */
function hm(v: unknown): string {
  const s = String(v).trim();
  if (!/^\d{2}:\d{2}$/.test(s)) die(`time "${s}" is not HH:MM`);
  return s;
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

/** An xsd:date or xsd:dateTime literal from a date + optional time. */
function dtLiteral(date: string, time?: string): string {
  return time ? `"${date}T${time}:00"^^xsd:dateTime` : `"${date}"^^xsd:date`;
}

/** Inclusive whole-day span between two YYYY-MM-DD dates (1 = same day). */
function spanDays(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const ms = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.round(ms / 86_400_000) + 1;
}

/** Minutes between two HH:MM times on the same day (0 if non-positive). */
function spanMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

// ── Load + validate ────────────────────────────────────────────────────────────
function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) die(`missing ${relative(REPO_ROOT, CONFIG_FILE)}`);
  const { data } = frontmatter(readFileSync(CONFIG_FILE, "utf8"), "calendar.config.md");
  for (const k of ["title", "namespace", "eventTypes"]) {
    if (data[k] == null) die(`calendar.config.md: missing required key "${k}"`);
  }
  const cfg: Config = {
    title: data.title,
    description: data.description,
    namespace: data.namespace,
    eventTypes: data.eventTypes,
    statuses: data.statuses ?? [],
  };
  if (!cfg.eventTypes.length) die("calendar.config.md: at least one eventType required");
  return cfg;
}

function loadEvents(cfg: Config): CalEvent[] {
  const typeIds = new Set(cfg.eventTypes.map((t) => t.id));
  const statusIds = new Set(cfg.statuses.map((s) => s.id));
  const files = readdirSync(CAL_DIR)
    .filter((f) => f.endsWith(".md") && !NON_EVENT.has(f))
    .sort();
  const events: CalEvent[] = [];
  const ids = new Set<string>();
  for (const f of files) {
    const { data, body } = frontmatter(readFileSync(join(CAL_DIR, f), "utf8"), f);
    for (const k of ["id", "title", "type", "date"]) {
      if (data[k] == null) die(`${f}: missing required key "${k}"`);
    }
    if (!typeIds.has(data.type)) die(`${f}: type "${data.type}" not in calendar.config.md`);
    if (data.status != null && !statusIds.has(data.status))
      die(`${f}: status "${data.status}" not in calendar.config.md`);
    const id = String(data.id);
    if (ids.has(id)) die(`duplicate event id "${id}" (${f})`);
    ids.add(id);
    const date = ymd(data.date);
    const time = data.time != null ? hm(data.time) : undefined;
    events.push({
      id,
      title: String(data.title),
      type: data.type,
      date,
      endDate: data.endDate != null ? ymd(data.endDate) : undefined,
      time,
      endTime: data.endTime != null ? hm(data.endTime) : undefined,
      status: data.status,
      location: data.location != null ? String(data.location) : undefined,
      attendees: (data.attendees ?? []).map(String),
      links: (data.links ?? []).map(String),
      tags: (data.tags ?? []).map(String),
      body,
      file: f,
      sortKey: `${date}T${time ?? "00:00"}`,
    });
  }
  events.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1));
  return events;
}

// ── Render ──────────────────────────────────────────────────────────────────────
function renderCalendar(cfg: Config, events: CalEvent[]): string {
  let out = prefixHeader(["rdfs", "ical", "sched", "dct", "xsd", "ui", "owl"], "#");
  out += `@prefix mc: <${cfg.namespace}> .\n\n`;
  out += `# Generated by scripts/calendar-build.ts from .mind/calendar/ — do not edit by hand.\n`;
  out += `# An ical:Vcalendar (http://www.w3.org/2002/12/cal/ical#) of dated project events.\n\n`;

  out += `#### Event types (subClassOf :Event → ical:Vevent) ####\n`;
  for (const t of cfg.eventTypes) {
    out += `:${className(t.id)} a rdfs:Class ;\n`;
    out += `    rdfs:label ${ttlShort(t.label)} ;\n`;
    out += `    rdfs:subClassOf :Event ;\n`;
    if (t.color) out += `    ui:backgroundColor ${ttlShort(t.color)} ;\n`;
    out = out.replace(/ ;\n$/, " .\n") + "\n";
  }
  out += `:Event a rdfs:Class ;\n`;
  out += `    rdfs:label "event" ;\n`;
  out += `    rdfs:subClassOf ical:Vevent ;\n`;
  out += `    owl:disjointUnionOf ( ${cfg.eventTypes.map((t) => ":" + className(t.id)).join(" ")} ) .\n\n`;

  out += `#### The calendar ####\n`;
  out += `:this a ical:Vcalendar ;\n`;
  out += `    dct:title ${ttlShort(cfg.title)} ;\n`;
  out += `    rdfs:label ${ttlShort(cfg.title)} ;\n`;
  if (cfg.description) out += `    dct:description ${ttlShort(cfg.description)} ;\n`;
  if (events.length)
    out += `    ical:component ${events.map((e) => `<#${e.id}>`).join(" , ")} ;\n`;
  out = out.replace(/ ;\n$/, " .\n") + "\n";

  out += `#### Events (chronological) ####\n`;
  for (const e of events) {
    const lines: string[] = [];
    lines.push(`a ical:Vevent , :${className(e.type)}`);
    lines.push(`ical:uid ${ttlShort(e.id)}`);
    lines.push(`ical:summary ${ttlShort(e.title)}`);
    lines.push(`mc:eventType ${ttlShort(e.type)}`);
    lines.push(`ical:dtstart ${dtLiteral(e.date, e.time)}`);
    if (e.endDate || e.endTime)
      lines.push(`ical:dtend ${dtLiteral(e.endDate ?? e.date, e.endTime)}`);
    // All-day flag + duration follow the SolidOS schedule shape
    // (https://solidproject.org/shapes/event — sched: = pim/schedule#).
    const allDay = e.time == null;
    lines.push(`sched:allDay ${allDay ? "true" : "false"}`);
    if (allDay && e.endDate) lines.push(`sched:durationInDays ${spanDays(e.date, e.endDate)}`);
    if (!allDay && e.endTime) lines.push(`sched:durationInMinutes ${spanMinutes(e.time!, e.endTime)}`);
    if (e.status) lines.push(`ical:status ${ttlShort(e.status.toUpperCase())}`);
    if (e.location) lines.push(`ical:location ${ttlShort(e.location)}`);
    for (const a of e.attendees) lines.push(`ical:attendee ${ttlShort(a)}`);
    if (e.tags.length) lines.push(`ical:categories ${e.tags.map(ttlShort).join(" , ")}`);
    for (const l of e.links) lines.push(`rdfs:seeAlso <${l}>`);
    // The body maps to cal:comment — the field SolidOS meeting-pane / schedule forms read
    // (per the MeetingShape & ScheduleEventShape). ical: shares cal:'s IRI, so ical:comment ≡ cal:comment.
    if (e.body) lines.push(`ical:comment ${ttlLong(e.body)}`);
    out += `<#${e.id}>\n    ` + lines.join(" ;\n    ") + " .\n\n";
  }
  return out.trimEnd() + "\n";
}

// ── Main ──────────────────────────────────────────────────────────────────────
const cfg = loadConfig();
const events = loadEvents(cfg);
const outputs: Record<string, string> = {
  "calendar.ttl": renderCalendar(cfg, events),
};

if (CHECK) {
  let drift = false;
  for (const [name, content] of Object.entries(outputs)) {
    const path = join(BUILD_DIR, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== content) {
      drift = true;
      console.error(`calendar-build --check: ${relative(REPO_ROOT, path)} is out of date — run "npm run calendar:build".`);
    }
  }
  if (drift) process.exit(1);
  console.log(`calendar-build --check: build/ is up to date (${events.length} events).`);
  process.exit(0);
}

if (!existsSync(BUILD_DIR)) mkdirSync(BUILD_DIR, { recursive: true });
for (const [name, content] of Object.entries(outputs)) {
  writeFileSync(join(BUILD_DIR, name), content, "utf8");
}
console.log(`calendar-build: wrote build/calendar.ttl (${cfg.eventTypes.length} event types, ${events.length} events).`);
