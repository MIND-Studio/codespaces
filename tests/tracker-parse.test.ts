import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrackerTrio } from "@/lib/tracker/parse";
import { groupByEpic } from "@/lib/tracker/model";

// Fixtures: this prototype's own committed `.mind/build` trio. The seed script
// pushes the same trio into a demo repo, so parsing it here guards the exact
// shape the bridge renders.
const BUILD = join(process.cwd(), ".mind", "build");
const read = (f: string) => readFileSync(join(BUILD, f), "utf-8");
const trio = {
  tracker: read("tracker.ttl"),
  epics: read("epics.ttl"),
  state: read("state.ttl"),
};

describe("parseTrackerTrio", () => {
  it("returns null when there is no state document", () => {
    expect(parseTrackerTrio({ tracker: null, epics: null, state: null }, "a", "b")).toBeNull();
  });

  it("parses states with open/closed flags from flow:Open/flow:Closed", () => {
    const t = parseTrackerTrio(trio, "alice", "codespaces-tracker")!;
    expect(t).not.toBeNull();
    const byId = new Map(t.states.map((s) => [s.id, s]));
    expect(byId.get("NeedsTriage")?.open).toBe(true);
    expect(byId.get("InProgress")?.open).toBe(true);
    expect(byId.get("Done")?.open).toBe(false);
    expect(byId.get("Wontfix")?.open).toBe(false);
    expect(t.categories.map((c) => c.id).sort()).toContain("Bug");
  });

  it("parses epics sorted by number with status + declared count", () => {
    const t = parseTrackerTrio(trio, "alice", "codespaces-tracker")!;
    expect(t.epics.map((e) => e.slug)).toEqual([
      "pod-owned-collaboration",
      "multi-user-collaboration",
      "mind-packages-hardening",
    ]);
    const pod = t.epics[0];
    expect(pod.number).toBe(1);
    expect(pod.status).toBe("active");
    expect(pod.issueCount).toBe(3);
  });

  it("joins each issue's state/category/epic across the three docs", () => {
    const t = parseTrackerTrio(trio, "alice", "codespaces-tracker")!;
    const byNum = new Map(t.issues.map((i) => [i.number, i]));

    // #128: closed (Done) feature under the pod-owned-collaboration epic.
    const i128 = byNum.get(128)!;
    expect(i128.stateId).toBe("Done");
    expect(i128.open).toBe(false);
    expect(i128.categoryId).toBe("Feature");
    expect(i128.epicSlug).toBe("pod-owned-collaboration");

    // #150: un-epic'd (General), in progress, has an assignee.
    const i150 = byNum.get(150)!;
    expect(i150.epicSlug).toBeUndefined();
    expect(i150.open).toBe(true);
    expect(i150.assignee).toBeTruthy();

    // #142 blocks two issues (resolved to their ULID local names).
    const i142 = byNum.get(142)!;
    expect(i142.blocks.length).toBe(2);
    expect(i142.afk).toBe(true);
  });

  it("groups issues by epic with a trailing General bucket", () => {
    const t = parseTrackerTrio(trio, "alice", "codespaces-tracker")!;
    const groups = groupByEpic(t, t.issues);
    const general = groups.find((g) => g.kind === "general");
    expect(general).toBeTruthy();
    expect(general!.issues.some((i) => i.number === 150)).toBe(true);

    const podEpic = groups.find(
      (g) => g.kind === "epic" && g.epic.slug === "pod-owned-collaboration",
    );
    expect(podEpic?.kind === "epic" && podEpic.issues.length).toBeGreaterThanOrEqual(2);

    // General is shown first.
    expect(groups[0].kind).toBe("general");
  });

  it("counts open vs closed for the status filter", () => {
    const t = parseTrackerTrio(trio, "alice", "codespaces-tracker")!;
    const open = t.issues.filter((i) => i.open).length;
    const closed = t.issues.length - open;
    expect(open).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0); // #128 Done
  });
});
