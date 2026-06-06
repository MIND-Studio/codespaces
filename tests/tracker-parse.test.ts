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
    expect(byId.get("Todo")?.open).toBe(true);
    expect(byId.get("Doing")?.open).toBe(true);
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

    // #150: un-epic'd (General). Its open/closed + assignee state churn as it's
    // worked (and every issue eventually lands at Done), so only the structural
    // join — that it resolves to the General bucket — is asserted against the
    // live board; the state/assignee joins are covered deterministically against
    // fixed inline trios below.
    const i150 = byNum.get(150)!;
    expect(i150.epicSlug).toBeUndefined();

    // #142 blocks two issues (resolved to their ULID local names).
    const i142 = byNum.get(142)!;
    expect(i142.blocks.length).toBe(2);
    expect(i142.afk).toBe(true);
  });

  it("joins wf:assignee onto an issue (deterministic, board-independent)", () => {
    // A minimal trio mirroring the real base scheme: tracker.ttl declares the
    // classes at `<#…>`, state.ttl references them via the `tracker.ttl#` prefix
    // and carries the issue with a wf:assignee. Decoupled from the live board so
    // claiming/handing-off issues never breaks this assertion.
    const tracker = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix flow: <http://www.w3.org/2005/01/wf/flow#> .
@prefix : <#> .
:Issue a rdfs:Class .
:Category a rdfs:Class .
:Doing a rdfs:Class ; rdfs:label "Doing" ; rdfs:subClassOf flow:Open , :Issue .
:Bug a rdfs:Class ; rdfs:label "Bug" ; rdfs:subClassOf :Category .
:this a flow:Tracker ; flow:issueClass :Issue ; flow:issueCategory :Category .
`;
    const state = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dc: <http://purl.org/dc/elements/1.1/> .
@prefix mc: <https://mindpods.org/ns/codespaces-tracker#> .
@prefix : <tracker.ttl#> .
<#01XDOIN0009> wf:tracker :this ; mc:number 9 ; dc:title "Assigned one" ;
    a :Doing , :Bug ;
    wf:assignee <http://localhost:3011/claude/profile/card#me> .
`;
    const t = parseTrackerTrio({ tracker, epics: null, state }, "alice", "demo")!;
    const issue = t.issues.find((i) => i.number === 9)!;
    expect(issue.stateId).toBe("Doing");
    expect(issue.open).toBe(true);
    expect(issue.categoryId).toBe("Bug");
    expect(issue.assignee).toBe(
      "http://localhost:3011/claude/profile/card#me",
    );
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

  it("partitions open vs closed for the status filter (board-independent)", () => {
    // Asserted against a fixed inline trio with exactly one Open and one Closed
    // issue rather than the live board — every real issue eventually lands at
    // Done, so a live `open > 0` assertion is not durable.
    const tracker = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix flow: <http://www.w3.org/2005/01/wf/flow#> .
@prefix : <#> .
:Issue a rdfs:Class .
:Category a rdfs:Class .
:Doing a rdfs:Class ; rdfs:label "Doing" ; rdfs:subClassOf flow:Open , :Issue .
:Done a rdfs:Class ; rdfs:label "Done" ; rdfs:subClassOf flow:Closed , :Issue .
:Bug a rdfs:Class ; rdfs:label "Bug" ; rdfs:subClassOf :Category .
:this a flow:Tracker ; flow:issueClass :Issue ; flow:issueCategory :Category .
`;
    const state = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dc: <http://purl.org/dc/elements/1.1/> .
@prefix mc: <https://mindpods.org/ns/codespaces-tracker#> .
@prefix : <tracker.ttl#> .
<#01XOPEN0001> wf:tracker :this ; mc:number 1 ; dc:title "Open one" ; a :Doing , :Bug .
<#01XDONE0002> wf:tracker :this ; mc:number 2 ; dc:title "Closed one" ; a :Done , :Bug .
`;
    const t = parseTrackerTrio({ tracker, epics: null, state }, "alice", "demo")!;
    const open = t.issues.filter((i) => i.open).length;
    const closed = t.issues.length - open;
    expect(open).toBe(1);
    expect(closed).toBe(1);
  });
});
