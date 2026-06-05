/**
 * Deterministic "issue vs epic" suggestion for the collaborative composer.
 *
 * An epic in `.mind` is a *goal that groups several issues* — so the signal we
 * look for is "this reads like a breakdown of multiple deliverables" rather than
 * "one focused change". Pure heuristic, no LLM: it reads the markdown the user
 * is co-writing and returns the suggested {@link DraftKind} plus a short,
 * human-readable reason for the `💡` hint. The user can always override the
 * toggle — this only pre-sets it.
 */
import type { DraftKind } from "./draft-doc";

export type KindSuggestion = { kind: DraftKind; reason: string };

const EPIC_KEYWORDS =
  /\b(epic|milestone|phase[sd]?|road\s?map|workstream|deliverables?|breakdown|sub-?(issues?|tasks?))\b/i;

/** Count level-2 markdown headings (`## …`), ignoring fenced code blocks. */
function countSections(md: string): number {
  return stripFences(md)
    .split("\n")
    .filter((l) => /^\s{0,3}##\s+\S/.test(l)).length;
}

/** Count checklist items (`- [ ]` / `- [x]`). */
function countTaskItems(md: string): number {
  return (md.match(/^\s*[-*+]\s+\[[ xX]\]\s+/gm) ?? []).length;
}

/** Drop fenced code blocks so their `#`/`-` lines don't read as structure. */
function stripFences(md: string): string {
  return md.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

export function suggestKind(markdown: string): KindSuggestion {
  const md = markdown ?? "";
  const sections = countSections(md);
  const tasks = countTaskItems(md);
  const len = md.trim().length;
  const keyword = md.match(EPIC_KEYWORDS)?.[0];

  // Strongest signal first.
  if (keyword) {
    return { kind: "epic", reason: `mentions “${keyword.toLowerCase()}” — reads like a grouping` };
  }
  if (tasks >= 5) {
    return { kind: "epic", reason: `${tasks} checklist items — likely several deliverables` };
  }
  if (sections >= 3) {
    return { kind: "epic", reason: `${sections} sections — looks like a breakdown` };
  }
  if (len > 1500 && sections >= 2) {
    return { kind: "epic", reason: "long, multi-section write-up — looks like a breakdown" };
  }

  // Otherwise it reads like one focused change.
  const bits: string[] = [];
  if (tasks > 0) bits.push(`${tasks} checklist item${tasks === 1 ? "" : "s"}`);
  if (sections > 0) bits.push(`${sections} section${sections === 1 ? "" : "s"}`);
  const detail = bits.length ? ` (${bits.join(", ")})` : "";
  return { kind: "issue", reason: `looks like one focused change${detail}` };
}
