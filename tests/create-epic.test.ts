import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTrackerOutputs } from "@/lib/tracker/build";
import { parseTrackerTrio } from "@/lib/tracker/parse";

/**
 * `createMindEpic` writes an `epic.md` into a fresh `<unix-seconds>_<rand4>/` dir
 * and re-folds. The git/push half needs a live bare repo, so here we verify the
 * load-bearing half: the fold accepts an epic dir that has only `epic.md` (no
 * issues) and emits it into epics.ttl — i.e. a freshly created, empty epic is
 * valid and renderable. (Mirrors what `createMindEpic` writes.)
 */
const ROOT = mkdtempSync(join(tmpdir(), "mind-epic-fold-"));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("empty epic folds and parses", () => {
  it("emits a new 0-issue epic into epics.ttl", () => {
    // Seed from this prototype's own authored tree.
    cpSync(join(process.cwd(), ".mind", "issues"), join(ROOT, ".mind", "issues"), {
      recursive: true,
    });

    const dir = join(ROOT, ".mind", "issues", "1780600000_zt99");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "epic.md"),
      [
        "---",
        "id: test-epic",
        'title: "A freshly created epic"',
        "status: planned",
        "created: 2026-06-05",
        "---",
        "",
        "Goal narrative.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const built = buildTrackerOutputs(ROOT);
    expect(built.outputs["epics.ttl"]).toContain("<#test-epic>");
    expect(built.outputs["epics.ttl"]).toContain("mc:issueCount 0");

    const tracker = parseTrackerTrio(
      {
        tracker: built.outputs["tracker.ttl"],
        epics: built.outputs["epics.ttl"],
        state: built.outputs["state.ttl"],
      },
      "alice",
      "demo",
    );
    expect(tracker).not.toBeNull();
    const epic = tracker!.epics.find((e) => e.slug === "test-epic");
    expect(epic).toBeDefined();
    expect(epic!.title).toBe("A freshly created epic");
  });
});
