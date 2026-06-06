import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * MC-160 C5: "the Registry index is rebuildable from the pod tracker
 * (projection, not source)." `projectTrackerToRegistry` upserts each tracker
 * issue by its stable `(repo_id, number)`, so re-projecting reconstructs the
 * same rows (idempotent), and rows from the legacy flat `issue.ttl` store are
 * left untouched.
 */

beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-projection-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
});

function trackerWith(issues: Array<Record<string, unknown>>) {
  return {
    title: "Test tracker",
    states: [],
    categories: [],
    epics: [],
    issues: issues.map((i) => ({
      iri: "#x",
      open: true,
      blocks: [],
      blockedBy: [],
      ...i,
    })),
  } as unknown as import("@/lib/tracker/model").Tracker;
}

describe("projectTrackerToRegistry (MC-160)", () => {
  it("projects tracker issues into the registry index by number, idempotently", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { projectTrackerToRegistry } = await import(
      "@/lib/registry/issue-projection"
    );
    const { listIssues, getIssueByNumber } = await import(
      "@/lib/registry/issues"
    );

    const repo = createRepo({
      owner: "alice",
      name: "proj",
      ownerWebId: "http://localhost:3011/alice/profile/card#me",
      ownerPodRoot: "http://localhost:3011/alice/",
    });

    const tracker = trackerWith([
      {
        id: "01ABCOPEN0007",
        number: 7,
        title: "Open bug",
        open: true,
        categoryLabel: "Bug",
        description: "boom",
        assignee: "http://localhost:3011/claude/profile/card#me",
      },
      {
        id: "01ABCDONE0003",
        number: 3,
        title: "Closed feature",
        open: false,
        categoryLabel: "Feature",
        description: "done",
      },
    ]);

    const { upserted } = projectTrackerToRegistry(repo, tracker);
    expect(upserted).toBe(2);

    const all = listIssues(repo.id, { status: "all" });
    expect(all.map((i) => i.number).sort()).toEqual([3, 7]);

    const seven = getIssueByNumber(repo.id, 7)!;
    expect(seven.title).toBe("Open bug");
    expect(seven.status).toBe("open");
    expect(seven.body).toBe("boom");
    expect(seven.labels).toEqual(["bug"]); // category label, lower-cased
    expect(seven.podUrl).toBe(
      "http://localhost:3011/alice/codespaces/proj/.mind/state.ttl#01ABCOPEN0007",
    );

    const three = getIssueByNumber(repo.id, 3)!;
    expect(three.status).toBe("closed");

    // Idempotent: re-projecting the same tracker yields the same two rows.
    projectTrackerToRegistry(repo, tracker);
    expect(listIssues(repo.id, { status: "all" })).toHaveLength(2);

    // A status flip in the tracker is reflected on the next projection.
    const flipped = trackerWith([
      { id: "01ABCOPEN0007", number: 7, title: "Open bug", open: false, categoryLabel: "Bug" },
    ]);
    projectTrackerToRegistry(repo, flipped);
    expect(getIssueByNumber(repo.id, 7)!.status).toBe("closed");
  });

  it("leaves a coexisting flat issue.ttl row untouched (back-compat)", async () => {
    const { createRepo } = await import("@/lib/registry/repos");
    const { createIssue, getIssueByNumber } = await import(
      "@/lib/registry/issues"
    );
    const { projectTrackerToRegistry } = await import(
      "@/lib/registry/issue-projection"
    );

    const repo = createRepo({
      owner: "alice",
      name: "coexist",
      ownerWebId: "http://localhost:3011/alice/profile/card#me",
      ownerPodRoot: "http://localhost:3011/alice/",
    });

    // A legacy flat-store issue (number 1).
    const flat = createIssue({
      repoId: repo.id,
      title: "Legacy flat issue",
      authorWebId: "http://localhost:3011/alice/profile/card#me",
      podUrl: "http://localhost:3011/alice/codespaces/coexist/issues/1/issue.ttl",
    });
    expect(flat.number).toBe(1);

    // Project a tracker that has a different number (2) — must not disturb #1.
    projectTrackerToRegistry(
      repo,
      trackerWith([{ id: "01XOPEN0002", number: 2, title: "Tracker issue", open: true }]),
    );

    const stillFlat = getIssueByNumber(repo.id, 1)!;
    expect(stillFlat.title).toBe("Legacy flat issue");
    expect(stillFlat.podUrl).toContain("/issues/1/issue.ttl");
    expect(getIssueByNumber(repo.id, 2)!.title).toBe("Tracker issue");
  });
});
